<script lang="ts">
    import { onMount } from "svelte";
    import * as api from "./lib/api";
    import type { Ban, Report } from "./lib/api";
    import { t } from "./lib/i18n";

    let bans = $state<Ban[]>([]);
    let reports = $state<Report[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

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

<p class="note">{t.moderationReadOnly}</p>

{#if loading}
    <div class="empty-state">{t.loading}</div>
{:else}
    <section>
        <h2>{t.moderationBans}</h2>
        <!-- Said on the screen, not only in the ADR: an administrator who believes a ban is permanent will not
             understand why the same person is back a minute later. -->
        <p class="note">{t.banStillReconnects}</p>

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
</style>
