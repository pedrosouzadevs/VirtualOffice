/**
 * The half of an OIDC login that has to survive the round trip to the identity provider.
 *
 * We hand it to the browser in a signed, short-lived cookie rather than keeping it in memory: the dashboard must
 * still work when there is more than one replica, and a login started on one instance may well come back on another.
 */
export interface OidcTransaction {
    /** Opaque value echoed back by the provider. Proves the callback answers a login *we* started. */
    readonly state: string;

    /** PKCE verifier. Binds the authorisation code to this transaction. */
    readonly codeVerifier: string;
}

/** Who the identity provider says the person is. Nothing about what they may do — that is the database's answer. */
export interface OidcIdentity {
    readonly email: string;
}

/**
 * Declared here so the dependency points inward: Application owns the contract, Infrastructure implements it over
 * `openid-client` (ADR-0002, decision #1). It is also what lets the barrier's tests run without a provider.
 */
export interface OidcAuthenticator {
    /**
     * Builds the URL the browser must be sent to, together with the transaction to remember until the callback.
     */
    createAuthorizationRequest(): Promise<{ authorizationUrl: string; transaction: OidcTransaction }>;

    /**
     * Completes the exchange.
     *
     * @param callbackUrl the full URL the provider redirected to, query string included.
     * @throws when the provider reports an error, the state does not match, or the answer carries no email. Every one
     * of those is a failed login, and the caller turns them all into the same refusal.
     */
    completeAuthorization(input: { callbackUrl: string; transaction: OidcTransaction }): Promise<OidcIdentity>;
}
