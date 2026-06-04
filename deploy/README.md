# Deploy on VPS

This stack runs the application and a local PostgreSQL container.

## Required files on the server

- `.env.production`
- `docker-compose.yml`
- `Dockerfile`
- `package-lock.json`

## Initial bootstrap

1. Start the database
2. Run Prisma migrations
3. Run the seed script
4. Start the application

## Default access created by seed

- `admin@corridasapp.com.br` / `12345678`
- `organizador@exemplo.com.br` / `12345678`
- `atleta@exemplo.com.br` / `12345678`
- `douglaslundy@gmail.com` / `12345678`
- `dlsistemas100@gmail.com` / `12345678`
