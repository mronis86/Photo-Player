# Which batch file to use

## Control via Netlify, playout gets local + cloud files

**This is the recommended setup: you control from Netlify; playout (Netlify or local) can show both cloud cues and local-file cues.**

1. **On the PC that has your images / runs the server:**  
   Run **Open Playout (Netlify) with Local Server.bat**.  
   - Starts the local server (for temp-asset).  
   - Opens the **Netlify** playout in the browser.

2. **In the Netlify controller** (same or another device):  
   - Open `https://your-site.netlify.app/controller` and sign in.  
   - In the header, set **Local server (for local-file cues):** to your PC’s URL, e.g. `http://192.168.1.100:3000` (the bat window shows the URL; use that PC’s IP).  
   - Enter the same **connection code** on the playout. Sync is via Supabase Realtime.

3. **Result:**  
   - **Cloud cues:** work as usual (signed URLs from Supabase).  
   - **Local-file cues:** when you Take one, the controller uploads to the URL you set (your PC’s server) and sends that image URL to the playout.

**Important – why local files don’t work when playout is on Netlify:**  
Browsers **block HTTP images on HTTPS pages** (mixed content). So if the playout on Computer B is opened at **Netlify** (HTTPS), it **cannot** load images from your PC (http://YOUR_IP:3000/...). So for **local-file cues** to work on the other PC:

- **On Computer B**, open the playout at **http://COMPUTER_A_IP:3000/playout.html** (the Local server URL + `/playout.html`), **not** at Netlify.  
- Then the playout page is HTTP and can load HTTP images from the same server. Use the same connection code; sync still works via Supabase Realtime.

So: **control via Netlify**; for **local + cloud** on the other PC, that PC opens **http://YOUR_IP:3000/playout.html** (not Netlify). Cloud-only can stay on Netlify playout.

---

## Cloud only (no local server)

- **Open Playout (Web).bat** – opens the Netlify playout.  
- Use the **controller** at `https://your-site.netlify.app/controller`.  
- Leave **Local server** empty. Only cloud cues will work.

---

## Summary

| Goal                              | What to do |
|-----------------------------------|------------|
| **Control via Netlify, local + cloud** | Run **Open Playout (Netlify) with Local Server.bat** on your PC. In the Netlify controller, set **Local server** to `http://YOUR_PC_IP:3000`. Use Netlify playout. |
| Cloud only                        | Use **Open Playout (Web).bat** for playout; controller at Netlify; leave Local server empty. |
| Everything local (no Netlify)     | Run **Open Playout (Local).bat**; controller and playout at `http://IP:3000`. |
