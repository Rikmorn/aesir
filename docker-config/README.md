# Docker Config

Configuration files bind-mounted into Docker containers via `docker-compose.yml`.

## Files

| File | Container | Mount Path |
|------|-----------|------------|
| `nginx.conf` | nginx reverse proxy | `/etc/nginx/nginx.conf` |

## Usage

These files are mounted read-only into containers. Changes require a container restart:

```bash
docker compose restart nginx     # After editing nginx.conf
```
