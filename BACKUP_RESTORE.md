# KING.EGY backup and recovery

## What is backed up

- PostgreSQL roles, schema, and data exports from Supabase.
- Image files referenced by `products.image_url` and `product_images.image_url` that belong to this project's public `product-images` bucket.
- The archive is encrypted with GPG AES-256 before it is uploaded as a GitHub Release asset. The repository is public, so **never upload a plaintext backup**.

## One-time GitHub setup

In the KING-EGY repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

1. `SUPABASE_DB_URL`: use the **Session pooler** connection string from Supabase → Connect. Replace its password placeholder with the database password. Do not paste the connection string into chat or commit it.
2. `BACKUP_PASSPHRASE`: a unique random passphrase of at least 24 characters. Save it in a password manager. If it is lost, the encrypted backups cannot be decrypted.

The scheduled workflow runs monthly and can also be started manually from **Actions → Encrypted Supabase backup → Run workflow**.

## Restore outline

1. Download `king-egy-backup.tar.gz.gpg` from the required GitHub Release.
2. Decrypt it locally: `gpg --output king-egy-backup.tar.gz --decrypt king-egy-backup.tar.gz.gpg` (enter the saved passphrase).
3. Extract it: `tar -xzf king-egy-backup.tar.gz`.
4. Restore the SQL exports to a suitable Supabase database using the matching PostgreSQL tools and connection string. Do not run a restore against the live production database without first checking the target and taking a fresh backup.
5. Re-upload the files in `backup-images/` to the `product-images` Storage bucket, preserving the paths recorded in `manifest.json`. The backup image files are named sequentially; the manifest maps each file to its original public URL/path.

A database dump does not itself contain Storage object bytes. This workflow separately archives the referenced product images. It does not back up Cloudflare configuration, custom domains, GitHub secrets, or Supabase project-level settings.

## Keep-alive

The separate keep-alive workflow performs read-only requests to the public `products` and `store_settings` tables three times a day. This usually creates enough activity to reduce inactivity-pausing risk, but Supabase does not guarantee that scheduled requests will prevent a pause. Check the GitHub Actions run history periodically and retain the Supabase warning emails.
