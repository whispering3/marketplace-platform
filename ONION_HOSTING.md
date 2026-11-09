# Onion hosting, providers and monthly budget

Research date: **September 12, 2026**, using official provider pages. Prices, stock, taxes and billing terms can change before purchase. These are planning references, not reserved quotes. For a first release with only the primary address, follow the [single-onion production launch runbook](PRODUCTION_LAUNCH_SINGLE_ONION.md).

## Project recommendation

Start with **five servers total**: two active onion applications, PostgreSQL primary, PostgreSQL replica and a separate Monero server. This prioritizes data recovery before adding web replicas. See the [infrastructure plan](DEPLOYMENT_AND_EXPANSION_STRATEGY.md).

IncogNET is a lower-cost candidate for applications and small databases. 1984 offers VPS disk expansion for a Monero node. Njalla is an alternative web entry point; Privex offers a dedicated financial server alternative. This selection compares published specifications and prices, not tested performance or support.

“Anonymous” is not a technical guarantee: XMR payments and Tor do not eliminate registration data, metadata or operator access to infrastructure. Confirm required customer information and acceptable-use policies. No absence of identity verification is assumed for any provider.

## Provider comparison

| Provider | Published reference | Suggested use and limitation |
| --- | --- | --- |
| **IncogNET** | 4 GB, 2 vCPU, 50 GB NVMe: **US$20/month**; 8 GB, 2 vCPU, 90 GB NVMe: **US$36/month** | Lower-cost application/small-database candidate; accepts XMR. The page mentions limited stock and six-month billing for plans from 1 GB despite monthly-equivalent prices. Confirm at checkout. [Plans](https://incognet.io/kvm-vps) |
| **1984 Hosting** | VPS #3: 4 GB/80 GB, **US$38.64/month**; #4: 8 GB/160 GB, **US$77.28/month**; #5: 16 GB/320 GB, **US$154.56/month**; additional 100 GB: **US$30/month** | Iceland option accepting XMR. Choose a VPS with administrative access, not shared hosting. Budget uses #5 plus 100 GB, totaling 420 GB for a pruned node; confirm expansion and usable space. [Prices](https://management.1984.hosting/product/pricelist/), [payments](https://1984.hosting/) |
| **Njalla** | VPS 30: 2 cores, 3 GB RAM, 30 GB: **€30/month**; VPS 45: 3 cores, 4.5 GB, 45 GB: **€45/month** | Swedish web entry alternative. These disks do not fit the proposed Monero node. Accepts XMR; customer manages the OS. [Servers](https://njal.la/servers/), [payments](https://njal.la/pricing/) |
| **Privex** | RYZ5-64-NVME-FIN1: 64 GB, 2 × 512 GB NVMe, **US$85/month + US$20 setup**, out of stock on September 13, 2026; available RYZ78-ZEN4-FIN: **US$140/month + US$70 setup** | Dedicated pruned-node alternative, not a VPS. Mirroring provides approximately one disk of usable capacity, not their sum. Confirm stock, payment method and storage configuration at checkout. [Order](https://pay.privex.io/order/choose-server), [provider](https://www.privex.io/) |

Confirm onion-service support, private tunnels, continuous node workloads, traffic/I/O limits, backups, location and account recovery. An onion service is different from a Tor exit relay; publishing this site does not require an exit relay.

## All-VPS budget

Assumptions: moderate load, two 4 GB applications, 8 GB databases, a pruned Monero node with expanded storage and self-managed operations. Application/database lines use the IncogNET references above; provider diversification can increase costs.

| Component | 4 servers total | 5 servers total |
| --- | ---: | ---: |
| Applications and mirrors: 2 × US$20 | US$40.00 | US$40.00 |
| PostgreSQL primary | US$36.00 | US$36.00 |
| PostgreSQL replica | — | US$36.00 |
| Monero VPS: US$154.56 + US$30 disk | US$184.56 | US$184.56 |
| **Server subtotal** | **US$260.56** | **US$296.56** |
| Estimated offsite backup allowance | US$15.00 | US$15.00 |
| Estimated monitoring allowance | US$5.00 | US$5.00 |
| Monthly base | US$280.56 | US$316.56 |
| Planning margin: 15% | US$42.08 | US$47.48 |
| **Approximate monthly budget** | **US$323** | **US$365** |

Backup and monitoring are allowances, not verified provider plans. The margin is not a fee. Excludes labor, taxes, currency conversion/spread, additional disk growth, excess traffic, incidents, Monero transaction fees and wallet liquidity. Object/backup storage is separate and is not counted as a VPS.

Advance payment can raise the initial outlay: US$20/month paid for six months means US$120 per server if confirmed at checkout. Monthly-equivalent cost does not imply monthly billing.

### Dedicated Monero alternative

The US$85 dedicated option was out of stock on September 13, 2026. Replacing the US$184.56 Monero VPS with the available US$140 dedicated server yields **US$252/month** for five servers. Add US$20 operational allowances and a 15% margin for **approximately US$313/month**, plus US$70 initial setup. This is **four VPS and one dedicated server**. Confirm stock, payment method and storage configuration before purchase.

### Four or five application servers alone

Four applications, two databases and one Monero VPS total **seven servers**, approximately **US$410/month**, with the same allowances and margin. Five applications total **eight servers**, approximately **US$433/month**. Additional dedicated Onionbalance manager VPS are excluded.

### BRL and XMR conversion

For illustration only, using **BRL 6.00 per US$1 as an assumption, not a live exchange rate**:

| Scenario | USD planning budget | Illustrative BRL |
| --- | ---: | ---: |
| 4 servers, all VPS | US$323 | R$1,938/month |
| 5 servers, all VPS | US$365 | R$2,190/month |
| 4 VPS + available dedicated Monero | US$313 | R$1,878/month |
| 4–5 applications, 7–8 total servers | US$410–433 | R$2,460–2,598/month |

Use the effective payment rate: `BRL cost = USD total × effective exchange rate`. For XMR: `XMR quantity = invoice amount / XMR price in invoice currency`. USD/EUR pricing does not imply a fixed monthly XMR amount. Convert currencies before adding euros and dollars.

## Monero RPC and storage

`monerod` validates and stores the blockchain. `monero-wallet-rpc` manages the wallet and API. The node has the main storage requirement; five applications do not need five blockchain copies.

The consulted documentation recommends at least 4 GB RAM and **250 GiB available SSD for a pruned node**, or **625 GiB for a full node**. Its blockchain sizes are a January 2026 snapshot, not a local measurement. This plan reserves 400–500 GB SSD for pruning and suggests **1 TB SSD or more** for a full node with growth. These are planning allowances rather than software minimums. [Monero requirements](https://docs.getmonero.org/running-node/monerod-systemd/).

The 420 GB scenario assumes pruning, not a full node. Check usable space after filesystem, logs and wallet data; monitor growth and synchronization time. RAID does not replace backups.

Use a single active spending wallet. Document recovery on another host, stopping the previous instance and reconciling outgoing transfers. Concurrent spending wallets are not automatic redundancy. The single financial host remains a payment availability dependency even when mirrors work.

## Onion publication and mirrors

A v3 onion address comes from the service's cryptographic identity and does not require commercial DNS registration. Preserve that identity for restoration; never publish private keys.

Each application can run Tor → loopback Nginx → loopback Next.js. Keep the primary and at least one mirror on separate hosts. Distribute additional addresses between hosts and document shared infrastructure so hostname count is not mistaken for physical redundancy.

One address across several hosts requires a specific Onionbalance v3 design, which is not provisioned by this repository. [Onionbalance documentation](https://onionservices.torproject.org/apps/base/onionbalance/man/onionbalance/).

Test page availability, latency and dependencies from an external Tor client. Keep known alternative addresses published if an application fails. Removing a mirror database entry does not redirect existing connections.

## Before purchase

Prioritize SSD capacity, intended-use support, location/latency, replacement availability and proven restoration. These services were not purchased or configured in this review. Resolve [deployment prerequisites](DEPLOYMENT_AND_EXPANSION_STRATEGY.md), select providers and rehearse loss of an application, database primary and wallet in staging.
