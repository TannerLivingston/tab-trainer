// Your own Guitar Pro files in /samples, for local development. They may be copyrighted, so a
// production build replaces this module with an empty list (see vite.config.ts) and the files
// never reach the output; the folder is also kept out of git.
export default import.meta.glob('/samples/*.{gp,gpx,gp3,gp4,gp5,gp7,gp8,GP,GPX}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
