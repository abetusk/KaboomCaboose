<!-- SPDX-License-Identifier: CC0-1.0 -->

# Deploying on a server

How to run the game on a server that already has Apache with a Let's
Encrypt certificate, under a path of the existing site, for example
`https://example.com/rails/`. The game server runs as a service on the
same machine; Apache passes the path on to it, and HTTPS stays Apache's.

The page works out its connection from its own address: at
`https://example.com/rails/` it connects to `wss://example.com/rails/ws`
and asks `https://example.com/rails/` whether the server is back after a
drop (`src/client/main.ts`). Neither the domain nor the path is written
in the code; only the Apache rules name the path.

## What the server needs

- Node 22.18 or later (it runs the `.ts` files directly; developed on
  Node 24). No `npm install`: the WebSocket library is in `vendor/`, and
  the server builds the page into `web/` itself when it starts.
- The Apache modules proxy, proxy_http and proxy_wstunnel.

## 1. Copy the code

From the development machine, the files as last committed:

```bash
cd ~/claude/voxel-rail && git archive --format=tar HEAD | ssh you@server 'sudo mkdir -p /opt/voxel-rail && sudo tar -x -C /opt/voxel-rail'
```

On the server, a user for the service, owning the folder (the server
writes `web/` when it starts):

```bash
sudo useradd --system --home /opt/voxel-rail --shell /usr/sbin/nologin voxelrail && sudo chown -R voxelrail: /opt/voxel-rail
```

## 2. The service

It listens on 127.0.0.1 only, so it is reached through Apache alone. Any
free port will do; the Apache rules must name the same one. No `--dev`.

`/etc/systemd/system/voxel-rail.service`:

```ini
[Unit]
Description=voxel-rail game server
After=network.target

[Service]
User=voxelrail
WorkingDirectory=/opt/voxel-rail
ExecStart=/usr/bin/node server/main.ts --host 127.0.0.1 --port 8080
Restart=on-failure
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

`which node` gives the path for `ExecStart` if Node is elsewhere.

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now voxel-rail && journalctl -u voxel-rail -n 20
```

The log ends with `voxel-rail server on http://127.0.0.1:8080/`.

## 3. Apache

In the site's HTTPS virtual host (the `*-le-ssl.conf` file certbot made,
in `/etc/apache2/sites-available/`), inside `<VirtualHost *:443>`. The
`/rails/ws` rule comes before `/rails/`. The redirect matters: opened as
`/rails` without the slash, the page's relative paths would point at
the main site.

```apache
ProxyPass        /rails/ws ws://127.0.0.1:8080/ws
ProxyPassReverse /rails/ws ws://127.0.0.1:8080/ws
ProxyPass        /rails/   http://127.0.0.1:8080/
ProxyPassReverse /rails/   http://127.0.0.1:8080/
RedirectMatch ^/rails$ /rails/
```

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel && sudo apachectl configtest && sudo systemctl reload apache2
```

## 4. Check

- `https://example.com/rails/`: the lobby lists the room Main and the
  difficulty list is filled.
- On the Quest, the same address; START AR needs the HTTPS page, which
  this is. No `adb reverse`.
- An empty lobby: `journalctl -u voxel-rail` and the Apache error log.
  A missing proxy_wstunnel is the likeliest cause.

## Updating

Step 1's `git archive` again, then:

```bash
sudo chown -R voxelrail: /opt/voxel-rail && sudo systemctl restart voxel-rail
```

A restart ends the runs in progress; open pages reconnect within a
second or two.

## Open to anyone

As of 2026-11-18, on a public address:

- anyone can make rooms, with no limit on how many (each is capped in
  size, and closes after its run or 5 minutes empty);
- the settings panel lets any player change their room's shared
  settings, and its Restart button restarts the room's run.

## Not verified

The Apache rules have not been run here (no Apache on the development
machine). The page under a path was checked through a stand-in proxy
doing the same mapping (`/rails/` and `/rails/ws` to the game server's
`/` and `/ws`) on 2026-11-18: the lobby filled and a test room played.
