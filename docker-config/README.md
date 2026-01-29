# Docker Config

Configuration files bind-mounted into Docker containers via `docker-compose.yml`.

## Files

| File | Container | Mount Path |
|------|-----------|------------|
| `nginx.conf` | nginx reverse proxy | `/etc/nginx/nginx.conf` |
| `temporal-dynamic-config.yml` | Temporal server | `/etc/temporal/dynamic_config.yml` |

## Usage

These files are mounted read-only into containers. Changes require a container restart:

```bash
docker compose restart nginx     # After editing nginx.conf
docker compose restart temporal  # After editing temporal-dynamic-config.yml
```
