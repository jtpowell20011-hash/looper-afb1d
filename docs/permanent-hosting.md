# Permanent Hosting For Looper

The local `http://192.168...` link is only a temporary LAN preview. A permanent iPhone-testable app needs an HTTPS host connected to the project repository.

## Recommended Setup

Use this stack for the PWA phase:

- GitHub repository for source control and update history.
- Netlify connected to that repository for continuous deployment.
- A stable Netlify URL first, then an optional custom domain later.

This gives Looper a permanent HTTPS URL, deploy logs, rollback history, preview deploys for branches, and automatic production updates whenever the main branch changes.

## Netlify Settings

This repo includes `netlify.toml`, so Netlify should pick up:

- Build command: `npm run build:pwa`
- Publish directory: `dist`
- Node version: `20`

If Netlify asks manually, use those same values.

## First-Time Deployment

1. Create or choose a GitHub repo for Looper.
2. Push this project to that repo.
3. In Netlify, choose **Add new project**.
4. Choose **Import an existing project**.
5. Connect the GitHub repo.
6. Confirm the build command is `npm run build:pwa`.
7. Confirm the publish directory is `dist`.
8. Deploy.
9. Rename the generated site to something stable, such as `looper-audio` if available.

The app URL will look like:

```text
https://looper-audio.netlify.app
```

## Update Flow

After the site is connected:

1. Make code changes locally.
2. Run `npm test`.
3. Run `npm run build:pwa`.
4. Push the changes to GitHub.
5. Netlify automatically builds and deploys the latest version.

For user testing, send the production URL. For iPhone home-screen testing, open the HTTPS URL in Safari and choose **Share > Add to Home Screen**.

## Monitoring

Use Netlify's project dashboard to monitor:

- Latest production deploy.
- Failed deploy logs.
- Previous deploys and rollbacks.
- Branch preview deploys.
- Basic traffic analytics if enabled.

For deeper monitoring later, add an uptime monitor such as Better Stack, UptimeRobot, or a GitHub Actions scheduled check against the production URL.
