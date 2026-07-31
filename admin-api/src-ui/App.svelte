<script lang="ts">
    import MemberRow from "./MemberRow.svelte";
    import * as api from "./lib/api";
    import type { Member } from "./lib/api";
    import { format, t } from "./lib/i18n";

    let me = $state<Member | null>(null);
    let members = $state<Member[]>([]);
    let knownTags = $state<string[]>([]);
    let search = $state("");

    let loading = $state(true);
    let busy = $state(false);
    let error = $state<string | null>(null);
    let warning = $state<string | null>(null);

    /** Debounces the search so a query does not leave for every keystroke. */
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    async function load(): Promise<void> {
        loading = true;
        try {
            [members, knownTags] = await Promise.all([api.listMembers(search), api.listTags()]);
            error = null;
        } catch (cause) {
            error = describe(cause, t.loadFailed);
        } finally {
            loading = false;
        }
    }

    /** Prefers the server's own explanation, falling back to ours when it did not give one. */
    function describe(cause: unknown, fallback: string): string {
        return cause instanceof api.ApiError && cause.message !== "" ? cause.message : fallback;
    }

    /** Replaces one row in place, so a mutation does not cost a full reload or move the row under the cursor. */
    function replace(updated: Member): void {
        members = members.map((member) => (member.email === updated.email ? updated : member));

        if (me?.email === updated.email) {
            me = updated;
        }
    }

    async function runMutation(action: () => Promise<void>): Promise<void> {
        busy = true;
        try {
            await action();
        } finally {
            busy = false;
        }
    }

    function onGrant(email: string, tag: string): void {
        void runMutation(async () => {
            try {
                const result = await api.grantTag(email, tag);

                // A member who did not exist before is now in the list, so a plain replace would drop them.
                if (members.some((member) => member.email === result.member.email)) {
                    replace(result.member);
                } else {
                    members = [...members, result.member].sort((a, b) => a.email.localeCompare(b.email));
                }

                // Surfaced, not swallowed: tags are case-sensitive, so a freshly created one is usually a typo that
                // grants nothing (ADR-0003).
                warning = result.createdTag ? format(t.tagCreatedWarning, { tag }) : null;
                error = null;
                knownTags = await api.listTags();
            } catch (cause) {
                error = describe(cause, t.grantFailed);
            }
        });
    }

    function onRevoke(email: string, tag: string): void {
        void runMutation(async () => {
            try {
                replace((await api.revokeTag(email, tag)).member);
                error = null;
            } catch (cause) {
                error = describe(cause, t.revokeFailed);
            }
        });
    }

    function onRename(email: string, username: string | null): void {
        void runMutation(async () => {
            try {
                replace((await api.setUsername(email, username)).member);
                error = null;
            } catch (cause) {
                error = describe(cause, t.nameSaveFailed);
            }
        });
    }

    function onSearchInput(): void {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void load(), 250);
    }

    $effect(() => {
        // Identify the administrator first: `fetchMe` is what sends an expired session to the login, so nothing else
        // has to handle that case on first paint.
        void api
            .fetchMe()
            .then((identity) => {
                me = identity;
                return load();
            })
            .catch((cause: unknown) => {
                error = describe(cause, t.loadFailed);
                loading = false;
            });

        return () => clearTimeout(searchTimer);
    });
</script>

<div class="page">
    <header class="bar">
        <h1>{t.appTitle}</h1>
        {#if me !== null}
            <div class="identity">
                <span>{t.signedInAs} <strong>{me.username ?? me.email}</strong></span>
                <button onclick={() => void api.logout()}>{t.signOut}</button>
            </div>
        {/if}
    </header>

    {#if warning !== null}
        <div class="banner warning" role="status">
            <span>{warning}</span>
            <button onclick={() => (warning = null)}>{t.dismiss}</button>
        </div>
    {/if}

    {#if error !== null}
        <div class="banner error" role="alert">
            <span>{error}</span>
            <button onclick={() => (error = null)}>{t.dismiss}</button>
        </div>
    {/if}

    <div class="toolbar">
        <div class="field">
            <label for="search">{t.searchLabel}</label>
            <input
                id="search"
                type="search"
                bind:value={search}
                oninput={onSearchInput}
                placeholder={t.searchPlaceholder}
            />
        </div>
        <button onclick={() => void load()} disabled={loading}>{t.refresh}</button>
    </div>

    {#if loading}
        <div class="empty-state">{t.loading}</div>
    {:else if members.length === 0}
        <div class="empty-state">{search.trim() === "" ? t.noMembers : t.noMatches}</div>
    {:else}
        <table>
            <thead>
                <tr>
                    <th>{t.columnMember}</th>
                    <th>{t.columnTags}</th>
                    <th>{t.columnActions}</th>
                </tr>
            </thead>
            <tbody>
                {#each members as member (member.email)}
                    <MemberRow
                        {member}
                        {knownTags}
                        {busy}
                        isSelf={me?.email === member.email}
                        {onGrant}
                        {onRevoke}
                        {onRename}
                    />
                {/each}
            </tbody>
        </table>
    {/if}
</div>
