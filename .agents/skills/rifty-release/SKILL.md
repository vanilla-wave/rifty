---
name: rifty-release
description: Publish a GitHub Release and summarize new capabilities and fixes.
disable-model-invocation: true
---

Make a release through GitHub Releases. Invoking this skill authorizes publication.

1. Read `docs/public/publishing.md` and `.github/workflows/release.yml`.
   Select an up-to-date default-branch SHA with green CI and an unused stable
   `vX.Y.Z` tag: the user's version, otherwise the next SemVer justified by changes.
2. Read the diff and CHANGELOGs from the previous release to that SHA. Write
   concise bullet lists grouped under "New" and "Fixed", each bullet describing
   one user-visible capability or fix. Omit empty groups; use the user's language.
3. Create and push the tag at the selected SHA. Publish the GitHub Release with
   `gh release create <tag> --verify-tag --title <tag> --notes-file <file>`.
4. Verify the published Release and successful `release.yml` completion for
   that exact tag and SHA. On failure, report the failed step and error link.

After success, return the release version/link and those bullet lists. Keep it brief.
