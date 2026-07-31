import type { Capabilities } from "@workadventure/messages";
import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { AdminDashboardConfiguration } from "../Application/AdminDashboardConfiguration";
import type { OidcAuthenticator } from "../Application/Ports/OidcAuthenticator";
import { CompanionCatalogue } from "../Application/CompanionCatalogue";
import type { MapDetailsConfiguration } from "../Application/MapDetailsService";
import type { MemberRepository } from "../Application/Ports/MemberRepository";
import type { TagRepository } from "../Application/Ports/TagRepository";
import type { RoomAccessConfiguration } from "../Application/RoomAccessService";
import { WokaCatalogue } from "../Application/WokaCatalogue";
import { SUPPORTED_CAPABILITIES } from "../Capabilities";
import { CapabilitiesController } from "./controllers/CapabilitiesController";
import { CompanionListController } from "./controllers/CompanionListController";
import { HealthController, type ReadinessCheck } from "./controllers/HealthController";
import { MapController } from "./controllers/MapController";
import { MembersController } from "./controllers/MembersController";
import { RoomAccessController } from "./controllers/RoomAccessController";
import { TagsController } from "./controllers/TagsController";
import { WokaListController } from "./controllers/WokaListController";
import { AdminAuthController } from "./controllers/AdminAuthController";
import { AdminMembersController } from "./controllers/AdminMembersController";
import { AdminTagsController } from "./controllers/AdminTagsController";
import { adminApiTokenAuthentication } from "./middlewares/adminApiTokenAuthentication";
import { adminSessionAuthentication } from "./middlewares/adminSessionAuthentication";
import { loginRateLimit } from "./middlewares/loginRateLimit";

export interface ServerDependencies {
    /**
     * Shared secret the pusher must present. Required with no default on purpose: a security boundary that can be
     * silently skipped is not a boundary.
     */
    adminApiToken: string;

    /** Everything `/api/map` needs. Injected rather than read from the environment so tests can vary it. */
    mapDetailsConfiguration: MapDetailsConfiguration;

    /** Everything `/api/room/access` needs. */
    roomAccessConfiguration: RoomAccessConfiguration;

    /** Where tags come from once `ADMIN_API_URL` is set. */
    memberRepository: MemberRepository;

    /** The tag catalogue behind the map editor's pickers. */
    tagRepository: TagRepository;

    /** Subsystem probes consulted by `/readyz`. Empty until Postgres lands (ADR-0002, P0/E4). */
    readinessChecks?: readonly ReadinessCheck[];

    /** Overridable so tests can assert the negotiation without depending on how much of P0 is built. */
    capabilities?: Capabilities;

    /** Overridable so tests can point at a fixture catalogue. */
    wokaCatalogue?: WokaCatalogue;

    /** Overridable so tests can point at a fixture catalogue. */
    companionCatalogue?: CompanionCatalogue;

    /**
     * The administration dashboard (ADR-0004).
     *
     * Absent means it is not configured: `/admin/*` answers a uniform 503 and **nothing about `/api/*` changes**.
     * Optional rather than required precisely so a dashboard misconfiguration can never stop the pusher-facing API,
     * whose failure hangs `play` (ADR-0002, Trap #2).
     */
    adminDashboard?: AdminDashboardDependencies;

    /**
     * Express's `trust proxy`. Only the login rate limiter reads it today, through `req.ip`.
     */
    trustProxy?: boolean | number | string;
}

export interface AdminDashboardDependencies {
    readonly configuration: AdminDashboardConfiguration;

    /** Injected rather than constructed here so the barrier's tests never need a live identity provider. */
    readonly authenticator: OidcAuthenticator;

    /** Overridable so the sliding-window and absolute-cap tests can drive the clock. */
    readonly now?: () => Date;

    /** Overridable so a test can assert the limit without issuing the production number of requests. */
    readonly rateLimit?: RequestHandler;
}

/**
 * Mounts `/admin`, or a uniform 503 in its place.
 *
 * Registered as one step so there is exactly one answer to "is the dashboard on?", and so the guard is mounted
 * before any route that sits behind it — Express matches in registration order, and a barrier registered after the
 * route it protects protects nothing.
 */
function mountAdminDashboard(app: Express, dependencies: ServerDependencies): void {
    const dashboard = dependencies.adminDashboard;

    if (dashboard === undefined) {
        app.use("/admin", (req: Request, res: Response) => {
            // Deliberately vague. Which variable is missing is in the startup log, where an operator can see it;
            // repeating it to an anonymous caller on a publicly reachable host would not be.
            res.status(503).json({
                status: "error",
                type: "error",
                code: "ADMIN_DASHBOARD_DISABLED",
                title: "Dashboard unavailable",
                subtitle: "",
                details: "The administration dashboard is not configured on this deployment.",
            });
        });
        return;
    }

    const cookieOptions = { secure: dashboard.configuration.publicUrl.startsWith("https://") };

    // Scoped to /admin: /api/* has no cookies to read, and keeping the parser off that path is one less thing
    // running in front of the endpoints the pusher depends on.
    app.use("/admin", cookieParser());

    app.use(
        "/admin",
        adminSessionAuthentication({
            sessionSecret: dashboard.configuration.sessionSecret,
            members: dependencies.memberRepository,
            cookieOptions,
            now: dashboard.now,
        }),
    );

    new AdminAuthController(app, {
        authenticator: dashboard.authenticator,
        members: dependencies.memberRepository,
        sessionSecret: dashboard.configuration.sessionSecret,
        cookieOptions,
        publicUrl: dashboard.configuration.publicUrl,
        rateLimit: dashboard.rateLimit ?? loginRateLimit(),
        now: dashboard.now,
    });

    // Everything under /admin/api is behind the barrier registered above, which has already proven the session,
    // re-read the admin tag and checked CSRF on every mutation (ADR-0004, G1).
    const administration = { members: dependencies.memberRepository, tags: dependencies.tagRepository };
    new AdminMembersController(app, administration);
    new AdminTagsController(app, dependencies.tagRepository);
}

/**
 * Builds the Express application without listening on a port.
 *
 * Keeping construction separate from binding is what lets the contract tests drive the real app over an ephemeral
 * port instead of booting the production server and racing on a fixed one.
 */
export function createServer(dependencies: ServerDependencies): Express {
    const app = express();

    // Express 5 defaults to the "simple" query parser, which leaves `a[]=1&a[]=2` as the literal key `a[]`. axios —
    // which is what the pusher uses — serialises array parameters exactly that way, so `characterTextureIds` would
    // silently arrive as undefined and every user would render with a blank avatar. "extended" (qs) folds the
    // bracketed form back into a real array.
    app.set("query parser", "extended");

    // Decides whether `X-Forwarded-For` is believed, and so which address the login rate limiter counts against.
    app.set("trust proxy", dependencies.trustProxy ?? 1);

    // The pusher only ever issues GETs and small JSON POSTs against this API; there is no reason to accept a large body.
    app.use(express.json({ limit: "100kb" }));

    // Registered before any /api route so new endpoints are guarded by default.
    app.use("/api", adminApiTokenAuthentication(dependencies.adminApiToken));

    const wokaCatalogue = dependencies.wokaCatalogue ?? new WokaCatalogue();
    const companionCatalogue = dependencies.companionCatalogue ?? new CompanionCatalogue();

    new HealthController(app, dependencies.readinessChecks ?? []);
    new CapabilitiesController(app, dependencies.capabilities ?? SUPPORTED_CAPABILITIES);
    new MapController(app, dependencies.mapDetailsConfiguration);
    new WokaListController(app, wokaCatalogue);
    new CompanionListController(app, companionCatalogue);
    new MembersController(app, dependencies.memberRepository);
    new TagsController(app, dependencies.tagRepository);
    new RoomAccessController(
        app,
        dependencies.memberRepository,
        wokaCatalogue,
        companionCatalogue,
        dependencies.roomAccessConfiguration,
    );

    mountAdminDashboard(app, dependencies);

    // Express's default 404 answers HTML. Every caller of this API parses responses as JSON with zod, so an
    // unimplemented path would surface as a confusing parse error instead of a plain "not found".
    app.use((req: Request, res: Response) => {
        res.status(404).json({
            status: "error",
            type: "error",
            code: "ADMIN_API_NOT_FOUND",
            title: "Not found",
            subtitle: "",
            details: `No handler for ${req.method} ${req.originalUrl}.`,
        });
    });

    // Must be registered last: Express only treats a 4-arity handler as an error handler, and only routes to it what
    // was raised after it was mounted. Without it, a thrown handler answers HTML, which every caller here parses as JSON.
    app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
        console.error(`[${new Date().toISOString()}] Unhandled error on ${req.method} ${req.originalUrl}`, error);

        if (res.headersSent) {
            next(error);
            return;
        }

        res.status(500).json({
            status: "error",
            type: "error",
            code: "ADMIN_API_INTERNAL_ERROR",
            title: "Internal server error",
            subtitle: "",
            details: "The Admin API failed to handle this request. The administrator has been notified.",
        });
    });

    return app;
}
