Commit the currently staged changes. Follow these rules exactly:

1. Run `git diff --cached` to see what is staged.
2. Write a commit message that is:
   - One short line (under 72 characters), lowercase, imperative mood (e.g., "add ticket filter endpoint")
   - Focused on *what* changed and *why*, not listing files
   - No emoji, no conventional commit prefixes (feat:, fix:, etc.) unless the repo already uses them
   - No "Co-Authored-By" or any attribution line
3. If nothing is staged, say so and stop.
4. Create the commit. Do not amend, do not push, do not stage additional files.
