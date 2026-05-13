# smart-update

Interactive CLI tool to update npm dependencies with version comparison and selective updates.

## Features

- Interactive selection of packages to update or uninstall
- Supports local project and global package modes
- `min-release-age` awareness to protect against supply chain attacks

## Requirements

- Node.js >= 18.0.0
- npm

`smart-update` is built for npm projects. It does not manage yarn, pnpm, or bun dependencies.

## Install

```sh
npm install -g @khlesk/smart-update
```

## Usage

```sh
smart-update            # Update local project dependencies
smart-update -g         # Update global packages
smart-update -b         # Bypass min-release-age for this run
smart-update -h         # Show help
smart-update -v         # Show version
```

## How it works

1. Scans your installed packages and checks for outdated versions
2. Presents a table of packages with installed and latest versions
3. Prompts you to choose an action:
   - **Update all** — update every outdated package
   - **Update selected** — pick specific packages to update
   - **Uninstall selected** — pick specific packages to remove
   - **Set min-release-age** — configure npm's supply-chain protection
   - **Quit** — exit without changes
4. Runs the chosen operation and shows a before/after diff

## Safety

`smart-update` runs real `npm update` and `npm uninstall` commands. Review the selected packages before confirming changes, and commit or stash important work first.

## min-release-age

`min-release-age` is an npm config option that prevents installing packages published within the last N days. This gives the community time to detect and report malicious packages before they reach your project.

If `min-release-age` is not configured, `smart-update` will offer to set it up for you in npm's global config so it is shared across projects. Use `--bypass-age` to skip the check for a single run.

## License

MIT
