import type { Capabilities } from "@workadventure/messages";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { CompanionCatalogue } from "../Application/CompanionCatalogue";
import type { MapDetailsConfiguration } from "../Application/MapDetailsService";
import type { MemberRepository } from "../Application/Ports/MemberRepository";
import type { RoomAccessConfiguration } from "../Application/RoomAccessService";
import { WokaCatalogue } from "../Application/WokaCatalogue";
import { SUPPORTED_CAPABILITIES } from "../Capabilities";
import { CapabilitiesController } from "./controllers/CapabilitiesController";
import { CompanionListController } from "./controllers/CompanionListController";
import { HealthController, type ReadinessCheck } from "./controllers/HealthController";
import { MapController } from "./controllers/MapController";
import { RoomAccessController } from "./controllers/RoomAccessController";
import { WokaListController } from "./controllers/WokaListController";
import { adminApiTokenAuthentication } from "./middlewares/adminApiTokenAuthentication";

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

    /** Subsystem probes consulted by `/readyz`. Empty until Postgres lands (ADR-0002, P0/E4). */
    readinessChecks?: readonly ReadinessCheck[];

    /** Overridable so tests can assert the negotiation without depending on how much of P0 is built. */
    capabilities?: Capabilities;

    /** Overridable so tests can point at a fixture catalogue. */
    wokaCatalogue?: WokaCatalogue;

    /** Overridable so tests can point at a fixture catalogue. */
    companionCatalogue?: CompanionCatalogue;
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
    new RoomAccessController(
        app,
        dependencies.memberRepository,
        wokaCatalogue,
        companionCatalogue,
        dependencies.roomAccessConfiguration,
    );

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
