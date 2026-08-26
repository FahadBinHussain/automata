# Steam free-license sweep — drives ASF with rate-limit detection, progress persistence, resume-safe
# Usage: python steam-free-license-sweep.py [--max N]
#   --max N  stop after N successful adds (default: unlimied, runs through all pending)
# Config reads from config.json (same format as claim-free-steam-packages)
# Progress files: activated_packages.txt (successful), skipped_packages.txt (permanently ungrantable)

import json, re, sys, time, os, logging
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# --- config ---
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json.local')
if not os.path.isfile(CONFIG_FILE):
    CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                               'claim-free-steam-packages', 'config.json')
with open(CONFIG_FILE) as f:
    cfg = json.load(f)

IPC_HOST = cfg['IPC']['host'].rstrip('/')
IPC_PW = cfg['IPC']['password']
BOT_NAME = cfg['IPC']['accounts'][0]
MAX_SUCCESS = None
if len(sys.argv) > 1:
    for i, a in enumerate(sys.argv):
        if a == '--max' and i+1 < len(sys.argv):
            MAX_SUCCESS = int(sys.argv[i+1])

ACTIVATED_FILE = os.path.join(os.path.dirname(__file__), 'activated_packages.txt')
SKIPPED_FILE = os.path.join(os.path.dirname(__file__), 'skipped_packages.txt')

# --- helpers ---
def asf_command(cmd):
    body = json.dumps({'command': cmd}).encode()
    req = Request(IPC_HOST + '/Api/command', data=body,
                  headers={'Authentication': IPC_PW, 'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def asf_post(path, payload):
    body = json.dumps(payload).encode()
    req = Request(IPC_HOST + path, data=body,
                  headers={'Authentication': IPC_PW, 'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def load_ids(filepath):
    if not os.path.isfile(filepath):
        return set()
    with open(filepath) as f:
        raw = f.read().strip()
        return set(x for x in raw.split(',') if x)

def save_id(filepath, appid):
    with open(filepath, 'a') as f:
        f.write(appid + ',')

def fetch_package_list():
    url = 'https://raw.githubusercontent.com/louisa-uno/claim-free-steam-packages/auto-update/package_list.txt'
    try:
        with urlopen(url, timeout=15) as r:
            return [x for x in r.read().decode().split(',') if x.isdigit()]
    except Exception:
        # fallback to local
        local = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                             'claim-free-steam-packages', 'package_list.txt')
        if os.path.isfile(local):
            with open(local) as f:
                return [x for x in f.read().split(',') if x.isdigit()]
        raise

# --- main loop ---
print('loading package list...')
all_apps = fetch_package_list()
activated = load_ids(ACTIVATED_FILE)
skipped = load_ids(SKIPPED_FILE)
pending = [a for a in all_apps if a not in activated and a not in skipped]
print(f'total: {len(all_apps)}, activated: {len(activated)}, skipped: {len(skipped)}, pending: {len(pending)}')

logfile = os.path.join(os.path.dirname(__file__), 'sweep.log')
if MAX_SUCCESS:
    print(f'will stop after {MAX_SUCCESS} successful adds')

consecutive_no_items = 0
total_success = 0
start_time = time.time()

for idx, appid in enumerate(pending):
    if MAX_SUCCESS and total_success >= MAX_SUCCESS:
        print(f'reached --max {MAX_SUCCESS}, stopping')
        break

    elapsed_h = (time.time() - start_time) / 3600
    avg_speed = total_success / elapsed_h if elapsed_h > 0 else 0
    remaining = len(pending) - idx
    eta_h = remaining / 48 if avg_speed < 1 else remaining / avg_speed

    # check rate-limit backoff
    if consecutive_no_items >= 3 and total_success == 0:
        logline = f'{idx}/{len(pending)} | rate-limited — sleeping 1h (no adds yet)'
        print(logline)
        time.sleep(3600)
        consecutive_no_items = 0
        continue  # retry same index

    tries = 0
    while tries < 5:
        try:
            resp = asf_command(f'!addlicense {BOT_NAME} app/{appid}')
            msg = resp.get('Message', '')
            result_text = resp.get('Result', '')
            full = f'{msg} {result_text}'.strip() if isinstance(result_text, str) else str(resp)

            if 'Items:' in str(full) or 'Aktivirte IDs:' in str(full):
                # confirmed success
                save_id(ACTIVATED_FILE, appid)
                consecutive_no_items = 0
                total_success += 1
                logline = f'{idx}/{len(pending)} | OK | app/{appid} | +1 (#{total_success})'
                print(logline)

                # log every 50
                if total_success % 50 == 0:
                    print(f'  [{total_success} added in {elapsed_h:.1f}h | {avg_speed:.1f}/hr | ETA ~{eta_h:.0f}h]')
                break

            elif 'AlreadyPurchased' in str(full) or 'Fail/AlreadyPurchased' in str(full):
                # already owned
                save_id(ACTIVATED_FILE, appid)
                consecutive_no_items = 0
                print(f'{idx}/{len(pending)} | already-owned | app/{appid}')
                break

            elif 'OK' in str(full):
                # Status: OK but no Items — not granted
                consecutive_no_items += 1
                logmsg = f'{idx}/{len(pending)} | OK-no-Items | app/{appid} (x{consecutive_no_items})'
                print(logmsg)
                if consecutive_no_items >= 5:
                    print('  5 consecutive OK-no-Items — likely rate-limited, backing off 1h')
                    time.sleep(3600)
                    consecutive_no_items = 0
                    continue  # retry same appid
                break

            else:
                # unexpected status
                print(f'{idx}/{len(pending)} | UNKNOWN | app/{appid} | {full[:200]}')
                break

        except (URLError, HTTPError) as e:
            tries += 1
            wait = min(tries * 30, 300)
            print(f'{idx}/{len(pending)} | conn-err (try {tries}) | app/{appid} | {e} — sleeping {wait}s')
            time.sleep(wait)
        except Exception as e:
            print(f'{idx}/{len(pending)} | error | app/{appid} | {e} — sleeping 60s')
            time.sleep(60)
            break

    # pacing: 74s as in original tool (slightly below 50/hr = 72s)
    time.sleep(74)

# final summary
elapsed = (time.time() - start_time) / 3600
print(f'\n--- done ---')
print(f'added: {total_success}')
print(f'elapsed: {elapsed:.1f}h')
print(f'rate: {total_success/elapsed:.1f}/hr' if elapsed > 0 else '')
print(f'activated: {len(load_ids(ACTIVATED_FILE))} total')