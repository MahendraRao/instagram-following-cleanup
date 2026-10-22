import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
if (!args.username || args.username === true) {
  fail('Missing --username. Example: --username your_instagram_username');
}

const username = String(args.username).replace(/^@/, '');
const shouldRun = Boolean(args.run);
const limit = positiveInteger(args.limit, 10, '--limit');
const minDelay = positiveInteger(args['min-delay'], 60_000, '--min-delay');
const maxDelay = positiveInteger(args['max-delay'], 120_000, '--max-delay');
const profileDir = String(args['profile-dir'] ?? '.ig-browser-data');

if (limit > 50) {
  fail('--limit cannot exceed 50. Use small batches and wait between runs.');
}

if (minDelay > maxDelay) {
  fail('--min-delay must be less than or equal to --max-delay.');
}

if (shouldRun && args.confirm !== username) {
  fail(`Run mode requires --confirm ${username}`);
}

main().catch((error) => {
  console.error(`\nStopped: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  console.log(shouldRun ? 'Mode: REAL UNFOLLOW' : 'Mode: DRY RUN (no changes)');
  console.log(`Profile: @${username}`);
  console.log(`Maximum this run: ${limit}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(15_000);

  await page.goto(`https://www.instagram.com/${username}/`, {
    waitUntil: 'domcontentloaded',
  });

  await waitForOwnedProfile(page, username);
  await openFollowingDialog(page, username);

  const dialog = page.locator('div[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible' });

  const processed = shouldRun
    ? await performUnfollows(page, dialog, limit)
    : await previewAccounts(page, dialog, limit);

  console.log(`\nFinished: ${processed} account(s) ${shouldRun ? 'unfollowed' : 'previewed'}.`);
  console.log('Close the browser window when you are finished checking the result.');
}

async function waitForOwnedProfile(page, username) {
  console.log('\nSafety check: waiting for your own profile page.');
  console.log('If asked, log in manually and return to this profile URL:');
  console.log(`https://www.instagram.com/${username}/`);

  for (let second = 0; second < 300; second += 1) {
    const pathname = new URL(page.url()).pathname.replace(/\/$/, '');
    const onTargetProfile = pathname.toLowerCase() === `/${username.toLowerCase()}`;
    const editProfile = page.getByText(/^Edit profile$/i).first();

    if (
      onTargetProfile
      && await editProfile.isVisible().catch(() => false)
    ) {
      console.log('Ownership confirmed: Edit profile is visible.');
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Could not confirm that @${username} is your logged-in profile. No actions were taken.`,
  );
}

async function openFollowingDialog(page, username) {
  const candidates = [
    page.locator(`a[href="/${username}/following/"]`).first(),
    page.getByRole('link', { name: /following/i }).first(),
    page.getByText(/^\s*\d[\d,.]*\s+following\s*$/i).first(),
  ];

  for (let attempt = 0; attempt < 30; attempt += 1) {
    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) {
        console.log('Opening the Following list...');
        await candidate.click();
        return;
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Could not find the Following counter. No actions were taken.');
}

async function performUnfollows(page, dialog, limit) {
  let processed = 0;
  let noButtonPasses = 0;

  while (processed < limit && noButtonPasses < 8) {
    const followingButton = dialog.getByRole('button', { name: /^Following$/i }).first();

    if (!await followingButton.isVisible().catch(() => false)) {
      noButtonPasses += 1;
      await scrollDialog(dialog);
      await page.waitForTimeout(1500);
      continue;
    }

    const account = await accountNameNear(followingButton);
    console.log(`[${processed + 1}/${limit}] Unfollowing ${account}`);
    await followingButton.click();

    const confirm = page.getByRole('button', { name: /^Unfollow$/i }).last();
    await confirm.waitFor({ state: 'visible', timeout: 10_000 });
    await confirm.click();

    processed += 1;
    noButtonPasses = 0;

    if (processed < limit) {
      const delay = randomInteger(minDelay, maxDelay);
      console.log(`Waiting ${Math.round(delay / 1000)} seconds...`);
      await page.waitForTimeout(delay);
    }
  }

  return processed;
}

async function previewAccounts(page, dialog, limit) {
  const seen = new Set();
  let unchangedPasses = 0;

  while (seen.size < limit && unchangedPasses < 8) {
    const buttons = dialog.getByRole('button', { name: /^Following$/i });
    const count = await buttons.count();
    const before = seen.size;

    for (let index = 0; index < count && seen.size < limit; index += 1) {
      const button = buttons.nth(index);
      if (!await button.isVisible().catch(() => false)) continue;

      const account = await accountNameNear(button);
      if (seen.has(account)) continue;

      seen.add(account);
      console.log(`[dry run ${seen.size}/${limit}] Would unfollow ${account}`);
    }

    unchangedPasses = seen.size === before ? unchangedPasses + 1 : 0;
    await scrollDialog(dialog);
    await page.waitForTimeout(1000);
  }

  return seen.size;
}

async function accountNameNear(button) {
  return button.evaluate((element) => {
    let node = element.parentElement;

    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const links = [...node.querySelectorAll('a[href^="/"]')];
      const profileLink = links.find((link) => /^\/[A-Za-z0-9._]+\/$/.test(link.getAttribute('href') ?? ''));
      if (profileLink) return `@${profileLink.getAttribute('href').split('/')[1]}`;
    }

    return '(visible account)';
  }).catch(() => '(visible account)');
}

async function scrollDialog(dialog) {
  await dialog.evaluate((root) => {
    const candidates = [root, ...root.querySelectorAll('*')]
      .filter((element) => element.scrollHeight > element.clientHeight + 20)
      .sort((a, b) => b.clientHeight - a.clientHeight);

    candidates[0]?.scrollBy({ top: 800, behavior: 'instant' });
  });
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function positiveInteger(value, fallback, optionName) {
  if (value === undefined || value === true) return fallback;
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`${optionName} must be a positive integer.`);
  }
  return number;
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
