<script lang="ts">
    import { isProtectedTag, type Member } from "./lib/api";
    import { format, t } from "./lib/i18n";

    interface Props {
        member: Member;
        /** Tags already in the catalogue, offered as suggestions so the free-text field is not the only path. */
        knownTags: string[];
        /** True when this row is the signed-in administrator, which is what triggers the self-revoke warning. */
        isSelf: boolean;
        busy: boolean;
        onGrant: (email: string, tag: string) => void;
        onRevoke: (email: string, tag: string) => void;
        onRename: (email: string, username: string | null) => void;
    }

    const { member, knownTags, isSelf, busy, onGrant, onRevoke, onRename }: Props = $props();

    let newTag = $state("");
    let editingName = $state(false);
    let draftName = $state("");

    const listId = $derived(`tags-${member.email}`);

    /**
     * Whether what is typed is a tag the server will refuse.
     *
     * Checked here so the button is disabled and the reason is on screen, rather than letting the click earn a 403
     * with no explanation. The server is still what enforces it.
     */
    const typedProtectedTag = $derived(isProtectedTag(newTag) ? newTag.trim() : null);

    function grant(): void {
        const tag = newTag.trim();
        if (tag === "" || isProtectedTag(tag)) {
            return;
        }

        onGrant(member.email, tag);
        newTag = "";
    }

    function revoke(tag: string): void {
        // Deliberately allowed, including for the last administrator (ADR-0004, decision #8) — the bootstrap restores
        // access on restart. Worth a confirmation all the same: it is the one click that logs you out of the tool.
        if (isSelf && tag === "admin" && !window.confirm(t.selfRevokeWarning)) {
            return;
        }

        onRevoke(member.email, tag);
    }

    function startEditing(): void {
        draftName = member.username ?? "";
        editingName = true;
    }

    function saveName(): void {
        const trimmed = draftName.trim();

        onRename(member.email, trimmed === "" ? null : trimmed);
        editingName = false;
    }
</script>

<tr>
    <td>
        <div class="email">{member.email}</div>
        {#if editingName}
            <div class="row-actions" style="margin-top: 0.35rem">
                <input
                    type="text"
                    bind:value={draftName}
                    placeholder={t.namePlaceholder}
                    aria-label={t.namePlaceholder}
                    onkeydown={(event) => {
                        if (event.key === "Enter") saveName();
                        if (event.key === "Escape") editingName = false;
                    }}
                />
                <button class="primary" onclick={saveName} disabled={busy}>{t.saveName}</button>
                <button onclick={() => (editingName = false)}>{t.cancel}</button>
            </div>
        {:else}
            <div class="name" class:empty={member.username === null}>{member.username ?? t.noName}</div>
        {/if}
    </td>

    <td>
        <div class="tags">
            {#each member.tags as tag (tag)}
                <span class="tag">
                    {tag}
                    <button
                        onclick={() => revoke(tag)}
                        disabled={busy}
                        title={format(t.revoke, { tag })}
                        aria-label={format(t.revoke, { tag })}>×</button
                    >
                </span>
            {/each}
        </div>
    </td>

    <td>
        <div class="row-actions">
            <input
                type="text"
                bind:value={newTag}
                list={listId}
                placeholder={t.addTagPlaceholder}
                aria-label={t.addTagPlaceholder}
                onkeydown={(event) => {
                    if (event.key === "Enter") grant();
                }}
            />
            <datalist id={listId}>
                {#each knownTags as tag (tag)}
                    <option value={tag}></option>
                {/each}
            </datalist>
            <button
                class="primary"
                onclick={grant}
                disabled={busy || newTag.trim() === "" || typedProtectedTag !== null}>{t.grant}</button
            >
            {#if !editingName}
                <button onclick={startEditing} disabled={busy}>{t.editName}</button>
            {/if}
        </div>
        {#if typedProtectedTag !== null}
            <div class="name empty">{format(t.protectedTagHint, { tag: typedProtectedTag })}</div>
        {/if}
    </td>
</tr>
