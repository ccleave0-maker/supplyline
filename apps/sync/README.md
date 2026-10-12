# SupplyLine Sync

A small program for one PC on your network (an office PC or server that is always on).
When SupplyLine runs online it can't reach your shared drives, so this does the
network-folder work for it:

- **Network filing** — writes copies of new documents (order lists as PDF and plain-white
  Excel, BOLs, POs, packing lists, receiving photos, approved vendor invoices, customer
  invoices, QC/MTRs, subcontracts) into your folders, sorted by company / job / type.
- **AP inbox** — sends invoices AP drops into each company's inbox folder to SupplyLine,
  then moves each file to *In review*, *Approved*, *Rejected* or *On hold* as the invoice
  moves along in the app.

If the SupplyLine server itself runs on your network and can open the folders, you don't
need this — choose **"The SupplyLine server writes them"** in Admin › Network filing.

## Set up (about 5 minutes)

1. Install **Node.js 22 or newer** from nodejs.org (the LTS version).
2. Copy this `sync` folder to the PC, e.g. `C:\SupplyLine Sync`.
3. In SupplyLine: **Admin › Network filing & Sync**
   - set *How files get there* to **SupplyLine Sync app**, and the folder (on that PC),
     e.g. `P:\SupplyLine` or `\server\share\SupplyLine`;
   - under **Sync app devices**, click **Add a PC**, name it, and copy the key
     (it's shown once).
   - AP folders are set per company in **Admin › Accounting**.
4. Copy `sync.config.example.json` to `sync.config.json` and fill in:
   - `server`: your SupplyLine address (the same one you sign in at);
   - `key`: the key from step 3.
5. Check it: open a Command Prompt in the folder and run
   `node supplyline-sync.mjs --test`
   It lists each company and whether each folder can be opened.

## Keep it running (Windows Task Scheduler)

Run this once in a Command Prompt **as the user who can open the shared drives**
(change the path if you put the folder somewhere else):

```
schtasks /Create /TN "SupplyLine Sync" /SC MINUTE /MO 1 /TR "node \"C:\SupplyLine Sync\supplyline-sync.mjs\" --once" /F
```

That does one pass every minute. To stop it: `schtasks /Delete /TN "SupplyLine Sync" /F`.

Or leave it running in a window: `node supplyline-sync.mjs` (checks every minute).

## Good to know

- Activity is written to `sync.log` next to the program.
- Files are never overwritten: if a different file already has the name, the copy gets
  " (1)", " (2)"… added.
- To stop a PC syncing, remove its key in Admin › Network filing & Sync.
- The key only lets this program collect files to file and hand in AP invoices. It can't
  sign in to SupplyLine or see anything else.
