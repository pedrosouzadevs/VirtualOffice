import { Issuer, custom, generators, type Client, type TokenSet } from "openid-client";
import type { AdminDashboardConfiguration } from "../../Application/AdminDashboardConfiguration";
import type { OidcAuthenticator, OidcIdentity, OidcTransaction } from "../../Application/Ports/OidcAuthenticator";

/**
 * Ceiling on every call to the identity provider.
 *
 * `openid-client` has no timeout of its own, so without this a provider that accepts connections and then goes quiet
 * holds the request open indefinitely. Well under the pusher's expectations because nothing on `/api/*` waits on this.
 */
const PROVIDER_TIMEOUT_MS = 10_000;

custom.setHttpOptionsDefaults({ timeout: PROVIDER_TIMEOUT_MS });

/**
 * The dashboard's OIDC client, over the same `openid-client@5.7.1` the pusher already uses.
 *
 * Modelled on [`play/src/pusher/services/OpenIDClient.ts`](../../../../play/src/pusher/services/OpenIDClient.ts),
 * with two deliberate differences: discovery failures are not cached, and PKCE is always on rather than optional.
 */
export class OpenIdConnectAuthenticator implements OidcAuthenticator {
    /** Discovery is a network call; caching the client keeps it to once per process. */
    private clientPromise: Promise<Client> | null = null;

    constructor(private readonly configuration: AdminDashboardConfiguration) {}

    /** Where the provider sends the browser back. Must match what the provider has registered, byte for byte. */
    public get redirectUri(): string {
        return `${this.configuration.publicUrl}/admin/callback`;
    }

    private client(): Promise<Client> {
        if (this.clientPromise === null) {
            this.clientPromise = Issuer.discover(this.configuration.oidc.issuer)
                .then(
                    (issuer) =>
                        new issuer.Client({
                            client_id: this.configuration.oidc.clientId,
                            client_secret: this.configuration.oidc.clientSecret,
                            redirect_uris: [this.redirectUri],
                            response_types: ["code"],
                        }),
                )
                .catch((error: unknown) => {
                    // Drop the cached promise so the next login retries. Keeping a rejected one would turn a provider
                    // that was briefly unreachable into a dashboard that stays broken until the service restarts.
                    this.clientPromise = null;
                    throw error;
                });
        }

        return this.clientPromise;
    }

    public async createAuthorizationRequest(): Promise<{ authorizationUrl: string; transaction: OidcTransaction }> {
        const client = await this.client();

        const codeVerifier = generators.codeVerifier();
        const state = generators.state();

        const authorizationUrl = client.authorizationUrl({
            scope: this.configuration.oidc.scope,
            state,
            code_challenge: generators.codeChallenge(codeVerifier),
            code_challenge_method: "S256",
            prompt: this.configuration.oidc.prompt,
        });

        return { authorizationUrl, transaction: { state, codeVerifier } };
    }

    public async completeAuthorization(input: {
        callbackUrl: string;
        transaction: OidcTransaction;
    }): Promise<OidcIdentity> {
        const client = await this.client();
        const parameters = client.callbackParams(input.callbackUrl);

        // `callback` is what enforces the state match, the PKCE verifier and the ID token signature. A provider that
        // answers with `error=access_denied` also surfaces here, as a throw.
        const tokenSet = await client.callback(this.redirectUri, parameters, {
            state: input.transaction.state,
            code_verifier: input.transaction.codeVerifier,
        });

        const email = await this.resolveEmail(client, tokenSet);

        if (email.trim() === "") {
            // Not a database miss — the provider authenticated someone we cannot name. Continuing would mean looking
            // a member up by an empty string.
            throw new Error("The identity provider returned no email claim; check that the 'email' scope is granted.");
        }

        return { email };
    }

    /**
     * Reads the email from the ID token, falling back to the userinfo endpoint.
     *
     * Claims first because they arrive with the token exchange already paid for. The fallback matters for providers
     * that keep the ID token minimal and expect a userinfo call — Entra ID among them, which F2 will bring.
     *
     * @returns the email, or an empty string when the provider offered none through either route.
     */
    private async resolveEmail(client: Client, tokenSet: TokenSet): Promise<string> {
        const claimed = tokenSet.claims().email;

        if (typeof claimed === "string" && claimed.trim() !== "") {
            return claimed;
        }

        const userinfo = await client.userinfo(tokenSet);

        return typeof userinfo.email === "string" ? userinfo.email : "";
    }
}
