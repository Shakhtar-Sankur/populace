# Publishing Populace Studio to the Microsoft Store

Everything the software needs is done. What remains is an account, three values
only Partner Center can give you, and one command.

## What is already in place

- **`appx` target** — `npm run dist:store`.
- **Fifteen visual assets**, generated from `build/icon.png` by
  `build/make-store-assets.mjs`: every logo size the manifest names, plus
  scale-200 variants for high-density displays. Without them electron-builder
  packs its own placeholder artwork and the listing ships with somebody else's
  images on the tile.
- **A privacy policy**, both in the application (screen 7) and at
  <https://shakhtar-sankur.github.io/gigzen/privacy.html>. The Store requires a
  reachable URL; the in-app copy is there because somebody deciding whether to
  point this at their staging environment should not have to leave the window
  to find out what it does with their data.
- **The in-app updater disables itself in a Store build.** Electron sets
  `process.windowsStore` on Store packages. A Store app updates through the
  Store, and offering a second path is both against policy and how people end
  up running a version nobody can account for.
- **No writes into the install folder.** A packaged app cannot write beside its
  own executable; Studio tests the config's folder by writing to it and falls
  back to `Documents\Populace\` when it cannot. That was fixed in 1.0.1 for a
  different reason and happens to be exactly what MSIX requires.

## What you have to do

### 1. Install the Windows SDK — done

`makeappx.exe` is what electron-builder shells out to, and it does not ship
with electron-builder. The Windows App Certification Kit comes with it, which
is worth running before submitting: it catches most rejections locally.

**`npm run dist:store` already works and has produced a package.** Two
obstacles are handled in `build/make-appx.mjs`, and both are written down
because neither is guessable from the error electron-builder prints, which is
`spawn UNKNOWN`:

- **Its bundled packaging tools are from 2018.** On Windows 11 the bundled
  `makepri` crashes with an access violation, and the bundled `makeappx`
  cannot be started by Node at all. The script stages the SDK's copies
  instead, taking the whole folder — these tools resolve private
  side-by-side assemblies from subdirectories beside them, so copying only the
  executables is not enough.
- **Those tools will not run from `%LOCALAPPDATA%`.** The identical binary,
  same SHA-256, starts from `C:\ebcache` and fails under `AppData\Local`
  with *"the application has failed to start because its side-by-side
  configuration is incorrect"*. Something on this machine blocks side-by-side
  loading from the user cache, so electron-builder's cache root is moved
  somewhere execution is allowed.

The package is **unsigned on purpose** — the Store signs it on submission
— and carries version `1.0.7.0`, the `runFullTrust` capability and the
fifteen generated assets. Verified by unpacking it and reading the manifest,
rather than by trusting the build log.

### 2. Register on Partner Center

Registering as **Gigzen Private Limited** means business verification: legal
entity documents and a D-U-N-S number, which takes days to weeks. Registering
as an individual is fast, but the listing then shows your name rather than the
company's, and changing it later means a new account.

### 3. Reserve the app name, then paste three values

Partner Center gives you these once the name is reserved. Put them in
`studio/package.json` under `build.appx`:

| Field | Where it comes from | Currently |
|---|---|---|
| `identityName` | Partner Center → Product identity → **Package/Identity/Name** | placeholder |
| `publisher` | Partner Center → **Package/Identity/Publisher**, the full `CN=…` string | placeholder |
| `publisherDisplayName` | Your publisher display name | `Gigzen Private Limited` |

They cannot be guessed. A wrong `publisher` produces a package that installs
locally and then fails certification for a reason that is not visible in the
error.

### 4. Build

```
npm run dist:store
```

The version becomes four parts automatically — `1.0.7` packs as `1.0.7.0`,
which is what MSIX requires with the last part zero.

### 5. Check it before Microsoft does

Run the Windows App Certification Kit against the produced `.appx`. It reports
the things reviewers reject for, and it is far faster than a submission round
trip.

### 6. Submit

Age rating questionnaire, description, support contact, and screenshots. Six
usable screenshots of the six screens already exist from the 1.0.5 release
photography.

## Two things worth knowing

**The Store signs the package.** That solves *"Windows protected your PC"* for
everyone who installs from the Store, at no cost. It does nothing for the
installer on our own download page — that still needs a code-signing
certificate.

**Store distribution and direct download can coexist.** They are separate
builds of the same source: `npm run dist` produces the signed-by-nobody NSIS
installer for the website, `npm run dist:store` produces the package Microsoft
signs. The application tells them apart at runtime and behaves accordingly.
