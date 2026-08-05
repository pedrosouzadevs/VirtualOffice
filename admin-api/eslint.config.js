import { generateConfig } from "@workadventure/eslint-config";

export default [
    ...generateConfig(import.meta.dirname),
    {
        rules: {
            // Custom rules for admin-api go here.
        },
    },
];
