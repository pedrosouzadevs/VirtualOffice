/**
 * Read access to the tag catalogue.
 *
 * Creating tags lives on {@link MemberRepository.ensureTag} instead, because the only thing that creates one today is
 * the bootstrap, alongside its member work. Splitting them is worth doing when tag CRUD arrives with the dashboard.
 */
export interface TagRepository {
    /**
     * Tags whose name contains `searchText`, case-insensitively.
     *
     * Unlike member search, an **empty `searchText` returns every tag**: the catalogue is small and curated, and the
     * pickers that consume this open with a list of options rather than waiting for input.
     */
    search(searchText: string, limit: number): Promise<string[]>;

    /** Every tag, ordered by name. */
    listAll(): Promise<string[]>;

    /**
     * Looks a tag up by exact name.
     *
     * @returns `undefined` when it does not exist. Revoking needs this rather than `ensureTag`, which would create
     * the very tag it is about to remove.
     */
    findByName(name: string): Promise<{ id: string; name: string } | undefined>;
}
