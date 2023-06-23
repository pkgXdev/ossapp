![screenshot](https://user-images.githubusercontent.com/58962/235918362-48efad34-8f7b-4420-81db-abfa0d7cafe7.jpg)

<p align="center">
  <a href="https://twitter.com/teaxyz">
    <img src="https://img.shields.io/badge/-teaxyz-2675f5?logo=twitter&logoColor=fff" alt="Twitter" />
  </a>
  <a href="https://discord.gg/JKzuqrW9">
    <img src="https://img.shields.io/discord/906608167901876256?label=discord&color=29f746" alt="Discord" />
  </a>
  <a href="https://docs.tea.xyz">
    <img src="https://img.shields.io/badge/-docs-2675f5?logoColor=fff&color=ff00ff&logo=gitbook" alt="Documentation & Manual" />
  </a>
</p>

tea/gui is the graphical app complement to [`tea/cli`].

Under the hood tea/gui installs and manages your packages with [`tea/cli`]
while exposing additional functionality, features and informational touches
that complement and expand upon the nature of package management.

To install the gui, visit: <https://tea.xyz/gui/> and download the latest
version. The gui auto-updates itself.

&nbsp;

# Contributing to `tea/gui`

If you have suggestions or ideas, start a [discussion]. If we agree, we’ll
move it to an issue. Bug fixes straight to pull request or issue please!

## Anatomy

tea/gui is a Svelte Electon app. The electron “backend” can be found in
`modules/desktop/electron`, the Svelte “frontend” is in both `modules/ui` and `modules/desktop/src`.

Generic UI components designed for use with Storybook are located in `modules/ui` and more complex
components with integrated business logic are in `modules/desktop/src`.

The following technologies are used:

- [svelte](https://svelte.dev/)
- [tailwind](https://tailwindcss.com/)
- [fontastic](https://fontastic.me)
- [electron](http://electronjs.org)

# Hacking on `tea/gui`

```sh
xc setup  # only required once
xc build  # only required if you modify the backend
xc dev    # opens the app in dev mode
```

> Make sure to run `xc prettier` before submitting pull-requests.

&nbsp;
# Internationalization / Translations
We need help translating our user interface into different languages. The translation related source code are all in `./modules/desktop/src/libs/translations/*`.

To add a new language:

1. Create a json file in `./modules/desktop/src/libs/translations/languages/[lang].json`. Copy the contents of `en.json` then translate.
2. Import the new language in `./modules/desktop/src/libs/translations/index.ts`. More instructions are in that file.


# Tasks

The following can be run with [`xc`], eg. `xc build`.

## Setup

Setup ensures that required configuration placeholder files are present and installs dependencies.

```sh
if [ ! -e modules/desktop/electron/config.json ]; then
  echo '{}' > modules/desktop/electron/config.json
fi

if [ ! -e modules/desktop/.env ]; then
  cp modules/desktop/.env.example modules/desktop/.env
fi

pnpm install
pnpm run -r prepare
```

## Build

```sh
pnpm install
pnpm build:desktop
```

## Build:lite

Builds a `.app` that is not codesigned or notarized. Ideal for local testing.

```
export CSC_IDENTITY_AUTO_DISCOVER=false
export MAC_BUILD_TARGET=dir
pnpm install
pnpm build:desktop
```

## Dev

```sh
pnpm install
pnpm dev
```

## Prettier

```sh
pnpm run --reporter append-only -r format
```

## Dist

```sh
pnpm install
pnpm --filter tea exec pnpm predist
pnpm --filter tea exec pnpm dist
```

## Check

Runs the typescript compiler and linter.

```sh
pnpm run -r check
pnpm run -r lint
```

## e2e

Runs the webdriver.io end to end tests. Assumes that `xc build` has already been executed.

```sh
pnpm run --reporter append-only -r e2e
```

## Bump

Inputs: PRIORITY

```sh
if ! git diff-index --quiet HEAD --; then
  echo "error: dirty working tree" >&2
  exit 1
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "error: requires main branch" >&2
  exit 1
fi

V=$(node -p "require('./modules/desktop/package.json').version")
V=$(tea semverator bump $V $PRIORITY)

if ! grep -F "\"version\": \"$V\",$" modules/desktop/package.json; then
  sed -i.bak -e "s/\"version\": .*,$/\"version\": \"$V\",/" modules/desktop/package.json
  rm modules/desktop/package.json.bak
  git add modules/desktop/package.json
  git commit -m "bump $V" --gpg-sign
fi

git push origin main
```

## Release

```sh
V="$(node -p "require('./modules/desktop/package.json').version")"
tea gh release create "v$V"
```




&nbsp;

# Dependencies

[`tea/cli`] will automagically make these available to your environment.

| Project                           |  Version  |
|-----------------------------------|-----------|
| nodejs.org                        | =18.16.0  |
| pnpm.io                           | =7.33.1   |
| xcfile.dev                        | >=0.4.1 |
| python.org                        | ^3.11     |

[`tea/cli`]: https://github.com/teaxyz/cli
[`xc`]: https://xcfile.dev
[discussion]: https://github.com/orgs/teaxyz/discussions
