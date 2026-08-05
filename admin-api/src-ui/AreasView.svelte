<script lang="ts">
    import * as api from "./lib/api";
    import type { Area, Room } from "./lib/api";
    import { format, t } from "./lib/i18n";

    interface Props {
        room: Room;
        onBack: () => void;
    }

    const { room, onBack }: Props = $props();

    let areas = $state<Area[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    /**
     * The property types worth naming in the reader's language.
     *
     * Everything else is shown by its raw type: the map editor gains properties over time, and a screen that hid the
     * ones it had no translation for would hide exactly the one somebody upgraded to find.
     */
    const FRIENDLY: Record<string, keyof typeof t> = {
        personalAreaPropertyData: "areaTypePersonal",
        silent: "areaTypeSilent",
        jitsiRoomProperty: "areaTypeMeeting",
        livekitRoomProperty: "areaTypeMeeting",
    };

    function labelFor(kind: string): string {
        const key = FRIENDLY[kind];

        return key === undefined ? kind : t[key];
    }

    async function load(): Promise<void> {
        loading = true;
        try {
            areas = await api.listAreas(room.path);
            error = null;
        } catch {
            error = t.areasUnavailable;
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        // Re-runs when the room changes, so picking another map from the list reloads rather than showing the last.
        void room.path;
        void load();
    });
</script>

<div class="toolbar">
    <button onclick={onBack}>← {t.backToRooms}</button>
    <div class="field">
        <strong>{room.name}</strong>
        <span class="name">{room.roomUrl}</span>
    </div>
</div>

{#if error !== null}
    <div class="banner error" role="alert">
        <span>{error}</span>
        <button onclick={() => void load()}>{t.refresh}</button>
    </div>
{/if}

{#if loading}
    <div class="empty-state">{t.loading}</div>
{:else if areas.length === 0 && error === null}
    <div class="empty-state">{t.noAreas}</div>
{:else if areas.length > 0}
    <table>
        <thead>
            <tr>
                <th>{t.columnArea}</th>
                <th>{t.columnAreaType}</th>
                <th>{t.columnOwner}</th>
            </tr>
        </thead>
        <tbody>
            {#each areas as area (area.id)}
                <tr>
                    <td>{area.name === "" ? area.id : area.name}</td>
                    <td>
                        <div class="tags">
                            {#each area.kinds as kind (kind)}
                                <span class="tag">{labelFor(kind)}</span>
                            {/each}
                        </div>
                    </td>
                    <td>
                        {#if area.personal === undefined}
                            <span class="name">—</span>
                        {:else if area.personal.ownerId === null}
                            <span class="name empty">{t.unclaimed}</span>
                        {:else}
                            <div class="email">{area.personal.ownerId}</div>
                            {#if area.personal.ownerUnknown}
                                <!-- Said out loud rather than left blank: it usually means the area was claimed
                                     before the Admin API was switched on, and that is actionable. -->
                                <div class="name empty">{t.unknownOwner}</div>
                            {:else if area.personal.ownerName}
                                <div class="name">{area.personal.ownerName}</div>
                            {/if}
                        {/if}

                        {#if area.personal !== undefined && area.personal.allowedTags.length > 0}
                            <div class="name">
                                {format(t.allowedTags, { tags: area.personal.allowedTags.join(", ") })}
                            </div>
                        {/if}
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>
{/if}
