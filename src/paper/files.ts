// The app's own files that a paper needs, loaded with the first one. They are
// named by their contents or by pdf.js's version, so once a newer build of the
// app is on the site, an open page's are gone from it: reloading gets the new
// ones.

/** One of the app's own files did not load. */
export class AppFileError extends Error {}

/** What loads one of the app's own files. */
export function appFile<T>(loading: Promise<T>): Promise<T> {
  return loading.catch((e: unknown) => {
    throw e instanceof AppFileError ? e : new AppFileError('A file of the app did not load.', { cause: e });
  });
}
