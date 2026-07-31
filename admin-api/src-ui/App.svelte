<script lang="ts">
    import MembersView from "./MembersView.svelte";
    import RoomsView from "./RoomsView.svelte";
    import * as api from "./lib/api";
    import type { Member } from "./lib/api";
    import { t } from "./lib/i18n";

    type Tab = "members" | "rooms";

    let me = $state<Member | null>(null);
    let error = $state<string | null>(null);

    /**
     * Kept in the URL hash rather than in memory alone.
     *
     * No router for two screens: a hash costs five lines and buys the two things a router would — a reload stays on
     * the screen you were looking at, and a link to the room list is a link somebody can send.
     */
    let tab = $state<Tab>(readTab());

    function readTab(): Tab {
        return typeof window !== "undefined" && window.location.hash === "#rooms" ? "rooms" : "members";
    }

    function show(next: Tab): void {
        tab = next;
        window.location.hash = next === "rooms" ? "#rooms" : "";
    }

    $effect(() => {
        // Identify the administrator first: `fetchMe` is what sends an expired session to the login, so no screen
        // behind it has to handle that case on first paint.
        void api
            .fetchMe()
            .then((identity) => {
                me = identity;
            })
            .catch((cause: unknown) => {
                error = cause instanceof api.ApiError ? cause.message : t.loadFailed;
            });

        const onHashChange = (): void => {
            tab = readTab();
        };

        window.addEventListener("hashchange", onHashChange);

        return () => window.removeEventListener("hashchange", onHashChange);
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

    <nav class="tabs" aria-label={t.appTitle}>
        <button
            class="tab"
            class:active={tab === "members"}
            aria-current={tab === "members"}
            onclick={() => show("members")}
        >
            {t.tabMembers}
        </button>
        <button class="tab" class:active={tab === "rooms"} aria-current={tab === "rooms"} onclick={() => show("rooms")}>
            {t.tabRooms}
        </button>
    </nav>

    {#if error !== null}
        <div class="banner error" role="alert">
            <span>{error}</span>
        </div>
    {/if}

    {#if tab === "members"}
        <MembersView {me} onMeChanged={(member) => (me = member)} />
    {:else}
        <RoomsView />
    {/if}
</div>

<style>
    .tabs {
        display: flex;
        gap: 0.25rem;
        margin-bottom: 1.25rem;
        border-bottom: 1px solid var(--border);
    }

    .tab {
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        background: transparent;
        padding: 0.5rem 0.9rem;
        color: var(--text-muted);
    }

    .tab:hover:not(.active) {
        color: var(--text);
        border-bottom-color: var(--border);
    }

    .tab.active {
        color: var(--text);
        border-bottom-color: var(--accent);
        font-weight: 600;
    }
</style>
