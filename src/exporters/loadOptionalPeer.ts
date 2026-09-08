/** Parameters for {@link loadOptionalPeer}. */
export interface LoadOptionalPeerParams<T> {
    /** Appended to the "missing peer" error, e.g. pointing at an alternative engine. */
    hint?: string;
    /** How to load the module once found, e.g. unwrapping a CJS default export. */
    load: () => Promise<T>;
    /** The package's exact name, used in the actionable install-command error. */
    packageName: string;
}

/**
 * Lazily load an optional peer dependency, throwing an actionable, install-
 * command-bearing error when it is genuinely missing. Kept out of the static
 * import graph so consumers who never call the feature that needs it never
 * pull the dependency in.
 *
 * @param params - The package name and how to load it.
 * @returns The loaded module.
 */
export async function loadOptionalPeer<T>(params: LoadOptionalPeerParams<T>): Promise<T> {
    const { hint = '', load, packageName } = params;
    try {
        return await load();
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code !== 'ERR_MODULE_NOT_FOUND') {
            throw new Error(`Failed to load '${packageName}': ${error.message}`, { cause: error });
        }
        throw new Error(
            `PNG export requires the optional peer dependency '${packageName}'. ` +
                `Install it with: npm install ${packageName}${hint}`
        );
    }
}
