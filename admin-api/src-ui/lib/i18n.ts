/**
 * Translations for the dashboard.
 *
 * Hand-rolled rather than pulled from a library: the whole surface is one screen and a handful of messages, and the
 * repository has no i18n runtime on this side to reuse — `play` uses `typesafe-i18n`, which brings a code generation
 * step that would cost more than it saves here. What matters is the rule, not the machinery: **no hard-coded strings,
 * en-US and pt-BR in lockstep**. Adding a language means adding one entry below.
 *
 * The `Messages` type is derived from the English catalogue, so a key added there fails the build until every other
 * language has it too. That is what keeps "translate it later" from being possible.
 */
const en = {
    appTitle: "VirtualOffice Administration",
    signedInAs: "Signed in as",
    signOut: "Sign out",

    searchLabel: "Search members",
    searchPlaceholder: "Email or name…",
    refresh: "Refresh",

    columnMember: "Member",
    columnTags: "Tags",
    columnActions: "Actions",

    noMembers: "No members yet.",
    noMatches: "No member matches that search.",
    loading: "Loading…",
    noName: "No display name",

    addTagPlaceholder: "Add a tag…",
    grant: "Grant",
    revoke: "Revoke {tag}",
    editName: "Edit name",
    saveName: "Save",
    cancel: "Cancel",
    namePlaceholder: "Display name",

    tagCreatedWarning:
        'The tag "{tag}" did not exist and was created. Tags are case-sensitive, so check this is not a typo — a new tag grants nothing on its own.',
    grantFailed: "The tag could not be granted.",
    revokeFailed: "The tag could not be revoked.",
    nameSaveFailed: "The name could not be saved.",
    loadFailed: "The member list could not be loaded.",
    dismiss: "Dismiss",

    selfRevokeWarning:
        "You are removing your own “admin” tag. You will lose access on your next action. Restarting admin-api restores it.",
    confirm: "Continue",
} as const;

export type Messages = Record<keyof typeof en, string>;

const ptBR: Messages = {
    appTitle: "Administração do VirtualOffice",
    signedInAs: "Conectado como",
    signOut: "Sair",

    searchLabel: "Buscar membros",
    searchPlaceholder: "E-mail ou nome…",
    refresh: "Atualizar",

    columnMember: "Membro",
    columnTags: "Tags",
    columnActions: "Ações",

    noMembers: "Nenhum membro ainda.",
    noMatches: "Nenhum membro corresponde a essa busca.",
    loading: "Carregando…",
    noName: "Sem nome de exibição",

    addTagPlaceholder: "Adicionar uma tag…",
    grant: "Conceder",
    revoke: "Revogar {tag}",
    editName: "Editar nome",
    saveName: "Salvar",
    cancel: "Cancelar",
    namePlaceholder: "Nome de exibição",

    tagCreatedWarning:
        'A tag "{tag}" não existia e foi criada. Tags diferenciam maiúsculas, então confira se não é um erro de digitação — uma tag nova não concede nada sozinha.',
    grantFailed: "Não foi possível conceder a tag.",
    revokeFailed: "Não foi possível revogar a tag.",
    nameSaveFailed: "Não foi possível salvar o nome.",
    loadFailed: "Não foi possível carregar a lista de membros.",
    dismiss: "Dispensar",

    selfRevokeWarning:
        "Você está removendo a sua própria tag “admin”. Vai perder o acesso na próxima ação. Reiniciar o admin-api restaura.",
    confirm: "Continuar",
};

const catalogues: Record<string, Messages> = { en, "pt-BR": ptBR };

/**
 * Picks a catalogue for a browser language list.
 *
 * Matches the region first (`pt-BR`) and then the bare language (`pt`), so a browser set to `pt-PT` gets Portuguese
 * rather than falling through to English over a region tag nobody meant to be strict about.
 */
export function resolveMessages(languages: readonly string[]): Messages {
    for (const language of languages) {
        const exact = catalogues[language];
        if (exact !== undefined) {
            return exact;
        }

        const base = language.split("-")[0]?.toLowerCase();
        const matched = Object.keys(catalogues).find((tag) => tag.split("-")[0]?.toLowerCase() === base);
        if (matched !== undefined) {
            return catalogues[matched] as Messages;
        }
    }

    return en;
}

/** Substitutes `{name}` placeholders. Absent values are left in place rather than printed as `undefined`. */
export function format(template: string, values: Record<string, string> = {}): string {
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * The catalogue for this browser. Read once: a language change means a reload anyway.
 *
 * Guarded rather than assumed: this module is also imported by unit tests running in Node, where `navigator` exists
 * but does not always carry `languages`.
 */
export const t: Messages = resolveMessages(globalThis.navigator?.languages ?? []);
