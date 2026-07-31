import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import {
    issueLoginTransaction,
    sanitizeReturnTo,
    verifyLoginTransaction,
} from "../../Application/AdminLoginTransaction";
import { issueSession, verifySession } from "../../Application/AdminSession";
import type { OidcAuthenticator } from "../../Application/Ports/OidcAuthenticator";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import { normalizeEmail } from "../../Domain/Member";
import {
    CSRF_HEADER,
    LOGIN_TRANSACTION_COOKIE,
    SESSION_COOKIE,
    clearLoginTransactionCookie,
    clearSessionCookies,
    setLoginTransactionCookie,
    setSessionCookies,
    type AdminCookieOptions,
} from "../AdminSessionCookies";
import { ADMIN_TAG } from "../middlewares/adminSessionAuthentication";

export interface AdminAuthControllerDependencies {
    readonly authenticator: OidcAuthenticator;
    readonly members: MemberRepository;
    readonly sessionSecret: string;
    readonly cookieOptions: AdminCookieOptions;
    readonly publicUrl: string;
    /** Applied to `/admin/login` only — the one route that talks to the identity provider on an anonymous request. */
    readonly rateLimit: RequestHandler;
    /** Injected so session lifetime is testable without waiting. */
    readonly now?: () => Date;
}

function errorBody(code: string, title: string, details: string): Record<string, string> {
    return { status: "error", type: "error", code, title, subtitle: "", details };
}

/**
 * The dashboard's authentication surface: `/admin/login`, `/admin/callback`, `/admin/logout` and `GET /admin/me`.
 *
 * The first three are allowlisted out of the session barrier — two are how a session is obtained and the third has to
 * work once it is gone. `/admin/me` is not, and is the first thing that proves the barrier admits anyone at all.
 */
export class AdminAuthController {
    constructor(
        private readonly app: Express,
        private readonly dependencies: AdminAuthControllerDependencies,
    ) {
        this.login();
        this.callback();
        this.logout();
        this.me();
    }

    private get now(): Date {
        return this.dependencies.now?.() ?? new Date();
    }

    private login(): void {
        this.app.get("/admin/login", this.dependencies.rateLimit, (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const returnTo = sanitizeReturnTo(
                    typeof req.query.returnTo === "string" ? req.query.returnTo : undefined,
                );

                const { authorizationUrl, transaction } =
                    await this.dependencies.authenticator.createAuthorizationRequest();

                const transactionToken = await issueLoginTransaction(
                    { ...transaction, returnTo },
                    this.dependencies.sessionSecret,
                    this.now,
                );

                setLoginTransactionCookie(res, transactionToken, this.dependencies.cookieOptions);
                res.redirect(302, authorizationUrl);
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to start an admin login`, error);

                // A 502 rather than the generic 500: the failure here is almost always the identity provider being
                // unreachable, and saying so is what stops the next person from looking for the bug in our code.
                res.status(502).json(
                    errorBody(
                        "ADMIN_LOGIN_PROVIDER_UNAVAILABLE",
                        "Login unavailable",
                        "The identity provider could not be reached. Try again in a moment.",
                    ),
                );
                next();
            });
        });
    }

    private callback(): void {
        this.app.get("/admin/callback", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const cookieOptions = this.dependencies.cookieOptions;
                const transactionToken: unknown = req.cookies?.[LOGIN_TRANSACTION_COOKIE];

                // Cleared on every path out of here. A transaction is single-use by definition, and leaving a spent
                // one behind is how a replayed callback becomes interesting.
                clearLoginTransactionCookie(res, cookieOptions);

                const transaction =
                    typeof transactionToken === "string"
                        ? await verifyLoginTransaction(transactionToken, this.dependencies.sessionSecret, this.now)
                        : undefined;

                if (transaction === undefined) {
                    res.status(400).json(
                        errorBody(
                            "ADMIN_LOGIN_EXPIRED",
                            "Login expired",
                            "This login is no longer valid. Start again from /admin/login.",
                        ),
                    );
                    return;
                }

                let email: string;

                try {
                    // Absolute because `openid-client` matches the whole URL, and `req.url` carries only the path.
                    const callbackUrl = `${this.dependencies.publicUrl}${req.originalUrl}`;
                    const identity = await this.dependencies.authenticator.completeAuthorization({
                        callbackUrl,
                        transaction,
                    });
                    email = identity.email;
                } catch (error: unknown) {
                    console.warn(`[${new Date().toISOString()}] An admin login failed at the provider`, error);
                    res.status(400).json(
                        errorBody(
                            "ADMIN_LOGIN_FAILED",
                            "Login failed",
                            "The identity provider did not confirm this login. Start again from /admin/login.",
                        ),
                    );
                    return;
                }

                const member = await this.dependencies.members.findByEmail(email);

                if (member === undefined || !member.tags.includes(ADMIN_TAG)) {
                    // Authentication answered *who*; this is the database answering *what they may do*, and it is the
                    // whole point of not letting the identity provider decide authorisation (ADR-0004, decision #2).
                    console.warn(
                        `[${new Date().toISOString()}] Refused a dashboard login for ${normalizeEmail(email)}: missing the "${ADMIN_TAG}" tag.`,
                    );
                    res.status(403).json(
                        errorBody(
                            "ADMIN_FORBIDDEN",
                            "Forbidden",
                            `The "${ADMIN_TAG}" tag is required to use the administration dashboard.`,
                        ),
                    );
                    return;
                }

                // The member's stored email, not the provider's casing: everything downstream keys off this value.
                const { token, session } = await issueSession(member.email, this.dependencies.sessionSecret, this.now);

                setSessionCookies(res, token, session, cookieOptions);
                res.redirect(302, transaction.returnTo);
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to complete an admin login`, error);
                next(error);
            });
        });
    }

    private logout(): void {
        // POST, never GET: logging someone out changes state, and a state-changing GET can be triggered by an
        // `<img>` tag on any page in the world (ADR-0004, mandatory test #9).
        this.app.post("/admin/logout", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const token: unknown = req.cookies?.[SESSION_COOKIE];
                const session =
                    typeof token === "string"
                        ? await verifySession(token, this.dependencies.sessionSecret, this.now)
                        : undefined;

                // Allowlisted out of the barrier, so the CSRF check lives here. Only meaningful when there *is* a
                // session — clearing cookies that are already absent is not something an attacker gains from.
                if (session !== undefined && req.get(CSRF_HEADER) !== session.csrfToken) {
                    res.status(403).json(
                        errorBody(
                            "ADMIN_CSRF_FAILED",
                            "Forbidden",
                            `State-changing requests must carry the session's CSRF token in the ${CSRF_HEADER} header.`,
                        ),
                    );
                    return;
                }

                clearSessionCookies(res, this.dependencies.cookieOptions);
                res.status(204).end();
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to log an administrator out`, error);
                next(error);
            });
        });
    }

    private me(): void {
        // Behind the barrier: reaching this handler at all already proves a valid session whose admin tag was
        // re-checked against the database on this very request.
        this.app.get("/admin/me", (req: Request, res: Response) => {
            const member = req.adminMember;

            if (member === undefined) {
                throw new Error("/admin/me was reached without the session barrier having run.");
            }

            res.status(200).json({
                // The email, never the internal primary key: the same rule the pusher-facing API follows
                // (ADR-0002, decision #5).
                email: member.email,
                username: member.username,
                tags: [...member.tags],
            });
        });
    }
}
