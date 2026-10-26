# Publishing DataTale Window Tracker

Each step that needs your sign-in is marked **You**. Claude can do the rest once you're signed in.

## 1. GitHub (the source code)

1. **You:** sign in to GitHub as the DataTale account (warren.dean@datatale.com.au). Create a free organisation called **datatale** at <https://github.com/organizations/plan>. If that name is taken, pick another and tell Claude, so it can update the links in `package.json`.
2. **You:** in a terminal, run `gh auth login`. Choose GitHub.com, then HTTPS, then log in with a web browser, using the DataTale account.
3. **Claude:** creates the public repo `datatale/window-tracker` and pushes the code (`gh repo create datatale/window-tracker --public --source . --push`).

The repo has to be public before step 2, because the store page loads the screenshot from it.

## 2. VS Code Marketplace

1. **You:** go to <https://marketplace.visualstudio.com/manage> and sign in with the Microsoft account you want to own the listing. Create a publisher with the ID **datatale** and the display name **DataTale**. The ID must match `"publisher"` in `package.json`.
2. **You:** create a Personal Access Token in Azure DevOps (<https://dev.azure.com>, then User settings, then Personal access tokens):
   - Organization: **All accessible organizations**
   - Scopes: **Custom defined**, then **Marketplace: Manage**
3. **You:** in this folder, run `npx @vscode/vsce login datatale` and paste the token when it asks. Paste it only into that prompt, never into a chat.
4. **Claude or you:** `npx @vscode/vsce publish`. The listing appears at `https://marketplace.visualstudio.com/items?itemName=datatale.window-tracker`, usually within a few minutes.

## 3. Open VSX (for Cursor, Windsurf, VSCodium)

1. **You:** sign in at <https://open-vsx.org> with GitHub, sign the publisher agreement under your profile, and create an access token.
2. **You:** run `npx ovsx create-namespace datatale -p <token>` once.
3. **You:** run `npx ovsx publish window-tracker-1.0.0.vsix -p <token>`.

## Releasing an update

1. Bump `"version"` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit and push.
3. Run `npx @vscode/vsce publish`, then `npx ovsx publish <new .vsix> -p <token>`.
