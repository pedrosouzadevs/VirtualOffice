<script lang="ts">
    import { onMount } from "svelte";
    import * as api from "./lib/api";
    import type { Ban, Report } from "./lib/api";
    import { t } from "./lib/i18n";

    let bans = $state<Ban[]>([]);
    let reports = $state<Report[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    /** The ban form (ADR-0006, decision #1). */
    let banIdentifier = $state("");
    let banMessage = $state("");
    let banning = $state(false);
    let notice = $state<string | null>(null);

    /**
     * Both lists are loaded together.
     *
     * They are two halves of one question — "what has been happening in the world" — and a screen where one half can
     * be stale while the other is fresh invites the wrong conclusion from a comparison of timestamps.
     */
    async function load(): Promise<void> {
        loading = true;
        try {
            [bans, reports] = await Promise.all([api.listBans(), api.listReports()]);
            error = null;
        } catch {
            error = t.moderationLoadFailed;
        } finally {
            loading = false;
        }
    }

    async function issueBan(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        const identifier = banIdentifier.trim();
        if (identifier === "" || banning) {
            return;
        }

        // A native confirm, like the self-revocation warning: banning is the most consequential click this
        // dashboard has, and it must never happen from an accidental Enter in the wrong field.
        if (!window.confirm(t.banConfirm.replace("{identifier}", identifier))) {
            return;
        }

        banning = true;
        try {
            const result = await api.issueBan(identifier, banMessage);

            // The two outcomes are both successes with different follow-ups; the screen says which one happened
            // instead of letting the administrator guess whether the person is already gone.
            notice = (result.kicked ? t.banIssuedKicked : t.banIssuedNotKicked).replace("{identifier}", identifier);
            error = null;
            banIdentifier = "";
            banMessage = "";
            await load();
        } catch (cause) {
            error = cause instanceof api.ApiError ? cause.message : t.banFailed;
        } finally {
            banning = false;
        }
    }

    /** The viewer's own locale, not the server's: whoever is reading is the one who has to recognise the time. */
    function when(iso: string): string {
        const date = new Date(iso);

        return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
    }

    onMount(() => void load());
</script>

{#if error !== null}
    <div class="banner error" role="alert">
        <span>{error}</span>
        <button onclick={() => void load()}>{t.refresh}</button>
    </div>
{/if}

{#if notice !== null}
    <div class="banner" role="status">
        <span>{notice}</span>
        <button onclick={() => (notice = null)}>{t.dismiss}</button>
    </div>
{/if}

<p class="note">{t.moderationNote}</p>

{#if loading}
    <div class="empty-state">{t.loading}</div>
{:else}
    <section>
        <h2>{t.moderationBans}</h2>

        <form class="ban-form" onsubmit={issueBan}>
            <input
                type="text"
                bind:value={banIdentifier}
                placeholder={t.banFormIdentifier}
                aria-label={t.banFormIdentifier}
                disabled={banning}
            />
            <input
                type="text"
                bind:value={banMessage}
                placeholder={t.banFormMessage}
                aria-label={t.banFormMessage}
                disabled={banning}
            />
            <button type="submit" class="danger" disabled={banning || banIdentifier.trim() === ""}>
                {t.banFormSubmit}
            </button>
        </form>

        {#if bans.length === 0}
            <div class="empty-state">{t.noBans}</div>
        {:else}
            <table>
                <thead>
                    <tr>
                        <th>{t.columnWhen}</th>
                        <th>{t.columnBannedUser}</th>
                        <th>{t.columnIssuedBy}</th>
                        <th>{t.columnMessage}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each bans as ban (ban.id)}
                        <tr>
                            <td>{when(ban.createdAt)}</td>
                            <td>
                                {#if ban.displayName}
                                    <div>{ban.displayName}</div>
                                {/if}
                                <div class="email">{ban.identifier}</div>
                                {#if ban.roomUrl}
                                    <div class="name">{ban.roomUrl}</div>
                                {/if}
                            </td>
                            <td><div class="email">{ban.issuedBy}</div></td>
                            <td>{ban.message}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </section>

    <section>
        <h2>{t.moderationReports}</h2>

        {#if reports.length === 0}
            <div class="empty-state">{t.noReports}</div>
        {:else}
            <table>
                <thead>
                    <tr>
                        <th>{t.columnWhen}</th>
                        <th>{t.columnReported}</th>
                        <th>{t.columnReporter}</th>
                        <th>{t.columnComment}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each reports as report (report.id)}
                        <tr>
                            <td>{when(report.createdAt)}</td>
                            <td>
                                <div class="email">{report.reportedIdentifier}</div>
                                {#if report.roomUrl}
                                    <div class="name">{report.roomUrl}</div>
                                {/if}
                            </td>
                            <td><div class="email">{report.reporterIdentifier}</div></td>
                            <!-- The comment is the whole point of a report, so it wraps rather than being clipped. -->
                            <td class="comment">{report.comment === "" ? t.noComment : report.comment}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </section>
{/if}

<style>
    section {
        margin-bottom: 2rem;
    }

    h2 {
        font-size: 1rem;
        margin: 0 0 0.5rem;
    }

    .note {
        color: var(--text-muted);
        font-size: 0.85rem;
        margin: 0 0 1rem;
    }

    .comment {
        white-space: pre-wrap;
        max-width: 32rem;
    }

    .ban-form {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
        flex-wrap: wrap;
    }

    .ban-form input {
        flex: 1 1 14rem;
    }

    /* The most consequential button on the dashboard should not look like a refresh. */
    .danger {
        border-color: var(--danger, #b91c1c);
        color: var(--danger, #b91c1c);
    }

    .danger:hover:not(:disabled) {
        background: var(--danger, #b91c1c);
        color: white;
    }
</style>
