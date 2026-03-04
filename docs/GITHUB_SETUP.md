# Get project on GitHub and clean up

## 1. Push this project to GitHub

In a terminal, from the project folder (`PHOTO PLAYER`):

```powershell
cd "c:\Users\audre\OneDrive\Desktop\PHOTO PLAYER"

# Initialize git
git init

# Stage everything (backup/copy files are ignored via .gitignore)
git add .
git commit -m "Initial commit: cut-only transitions, ready to add fade/wipe later"

# Create a new repo on GitHub (in browser):
#   github.com → New repository → name it e.g. "photo-player" → Create (no README/license)

# Add GitHub as remote and push (replace YOUR_USERNAME and REPO_NAME with yours)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

If you use GitHub CLI (`gh`):

```powershell
git init
git add .
git commit -m "Initial commit: cut-only transitions"
gh repo create photo-player --private --source=. --push
```

---

## 2. Remove a file from a branch after upload

Yes, you can remove files from a branch after pushing. Two common cases:

### A) Stop tracking a file (delete from repo, keep locally)

```powershell
git rm --cached "path/to/file - Copy (claude).tsx"
git commit -m "Stop tracking backup file"
git push
```

The file stays on your disk but is no longer in the repo. Add a matching entry to `.gitignore` so it doesn’t get added again.

### B) Delete the file in the repo (and optionally locally)

```powershell
git rm "path/to/file - Copy (claude).tsx"
git commit -m "Remove backup file from repo"
git push
```

This removes it from the branch; the file is also deleted locally unless you restore it from the commit before this one.

---

## 3. Reverting when transitions break

After the project is on GitHub:

- **Revert a specific commit:**  
  `git revert <commit-hash>`  
  then `git push`

- **Reset to a previous commit (rewrites history):**  
  `git log` to find the good commit hash, then  
  `git reset --hard <commit-hash>`  
  `git push --force`  
  (Only do this if you’re sure; it rewrites history.)

- **Compare with GitHub:**  
  Use the GitHub website or `git diff origin/main` to see what changed.

Your `.gitignore` already excludes `*- Copy*` and `*- Copy (*)*` so backup/copy files won’t be committed by default.
