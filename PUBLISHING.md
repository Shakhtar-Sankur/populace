# Publishing Populace

`@gigzen/populace` **is published**, through 1.3.4 on 16 September 2026. Each
release needs your npm account, and publishing is close to irreversible: npm
only allows unpublishing within 72 hours, and only under conditions.

`populace` unscoped is taken by an unrelated package (Populace.cloud SDK), which
is why the scope exists.

## Before you publish

Everything below has already been verified by packing the tarball and installing
it into a clean project:

- 41 files, 142 KB packed (421 KB unpacked) as of 1.3.4
- `added 1 package` — zero runtime dependencies, at install time
- `npx populace demo` finds the planted defect and exits 1
- `npx populace init` scaffolds `populace.config.mjs` and `adapters/my-app.mjs`
- `npx populace doctor` reports 2/13 on that scaffold and refuses to run
- `prepublishOnly` runs the self-tests, so a failing build cannot reach npm

## Publish

```bash
cd populace
npm adduser                 # or: npm login
npm publish                 # publishConfig.access is already public
```

If `@gigzen` does not exist as an organisation on npm yet, create it first at
npmjs.com/org/create — the free tier covers public packages. The scope must
match the name in `package.json`.

## Immediately after

The install instructions on the website, the READMEs and the product sheet
still say **clone-and-run**, because that is what works today. Do not change
them by hand. Run:

```bash
node scripts/announce-npm.mjs
```

It rewrites every place that carries an install instruction, and refuses to do
anything until it has confirmed the package is actually live on the registry —
so the site cannot advertise a command that does not work yet. That mistake has
already happened once here: the profile README briefly told people to run
`npx populace demo`, which would have run a stranger's package.

## Versioning

`0.1.0` is honest for what this is: the engine and safety model are solid and
have found real defects, but it has been pointed at exactly one real backend so
far, and that backend was ours. Reach `1.0.0` when it has run against an app
that is not yours.
