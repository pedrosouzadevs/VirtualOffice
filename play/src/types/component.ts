import type { Component } from "svelte";

export type ArqueumSpaceComponentProps = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArqueumSpaceComponent<Props extends ArqueumSpaceComponentProps = any> = Component<
    Props,
    Record<string, unknown>,
    string
>;
