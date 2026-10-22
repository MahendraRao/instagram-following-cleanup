# Building a Safer Local Instagram Following Cleanup Tool

An Instagram profile can accumulate thousands of followed accounts over years.
The number grows through recommendations, interests that change, temporary
projects, and simple curiosity. Eventually, the Following list can become much
larger than the group of accounts that still matters to the owner.

That was the starting point for this project: one account was following more
than eight thousand profiles, while the built-in interface only offered a
manual, one-account-at-a-time cleanup workflow.

The goal was not to build a social-media bot. It was to build a narrow local
utility that repeats one action the account owner can already perform: open the
Following list, choose an account, and confirm Unfollow.

## Defining the boundary

Instagram exposes two different relationship lists:

- **Followers** are accounts that follow you.
- **Following** are accounts that you follow.

Unfollowing an account changes only the second relationship. It does not remove
that account from your Followers list. Keeping this distinction explicit was
important because a broad automation script operating on the wrong dialog could
change the wrong side of the relationship.

The utility therefore navigates only to the Following dialog. It never opens the
Followers-management interface.

## Why browser automation

The tool uses Playwright to control a visible local Chrome window. This approach
keeps authentication in the browser and avoids asking the user to place a
password in source code, a configuration file, or a command-line argument.

The browser uses a dedicated profile stored in `.ig-browser-data/`. On the first
run, the owner signs in manually and completes any 2FA or challenge presented by
Instagram. Later runs can reuse that local session.

The browser remains visible throughout the process. That makes the behavior
observable and gives the user an immediate stop mechanism: `Control+C` in the
terminal or closing the automation window.

## Safety checks before action

Automation should fail closed when it cannot establish context. Before opening
the Following list, the script checks two things:

1. The browser URL matches the username supplied on the command line.
2. The page visibly contains **Edit profile**, indicating that the logged-in
   user owns the profile.

Real actions require three explicit command-line inputs: `--run`, the target
`--username`, and a matching `--confirm` value. Accidentally omitting any of
these leaves the tool in dry-run mode or stops it with an error.

The run size is capped at 50. A random delay, normally 60 to 120 seconds, is
inserted after each unfollow. These measures reduce the blast radius of mistakes
and discourage unattended high-volume use, although they cannot guarantee that
Instagram will not restrict the account.

## The cleanup loop

After the safety check, the script opens the Following dialog and finds buttons
whose accessible name is `Following`. In a real run, each iteration:

1. Identifies the account associated with the next visible Following button.
2. Clicks Following.
3. Waits for Instagram's confirmation dialog.
4. Clicks Unfollow.
5. Logs the completed account and waits for a randomized interval.

The button changes to `Follow` after a successful action, so it is no longer
eligible for the next iteration. The script continues until it reaches the
requested limit or cannot find another visible Following control.

Dry-run mode follows the same discovery path without clicking either button.
It is the right first step after installation or after Instagram changes its web
interface.

## A deliberately simple decision model

The current version does not decide whether an account is a friend, colleague,
creator, celebrity, or inactive profile. It processes entries in the order
Instagram presents them. This is appropriate only when the user's stated goal is
to clear the Following list without exceptions.

That limitation became obvious during real use: an automated batch may include
accounts the owner later realizes they want to keep. Those accounts can be
followed again manually, but a better future version would support an explicit
allowlist and produce a reviewable plan before a run.

## What worked well

Several choices made the tool easier to trust:

- A visible browser made every action inspectable.
- Manual login kept credentials out of the program.
- Dry-run mode provided a no-change validation path.
- Ownership verification prevented running against an arbitrary profile.
- Random delays and small batches made progress slow but controlled.
- Terminal logging created a simple audit trail of each processed username.

## Limitations and maintenance

This is user-interface automation, so it depends on labels and page structure
that Instagram can change without notice. A selector that works today may stop
finding the Following counter or confirmation button later. The correct response
is to stop, inspect the updated interface, and revise the selector, not to remove
the safety check.

There is also no official guarantee that automated unfollowing is permitted.
Instagram may show warnings, require verification, temporarily block actions, or
take other enforcement measures. The project does not attempt to bypass any of
those controls.

## Where the project can go next

Useful improvements would include:

- An allowlist for accounts that must remain followed.
- A generated preview file requiring approval before execution.
- Checkpointing and resumable batches.
- Better detection of action blocks and UI changes.
- Automated tests against a local mock of the Following dialog.

The core principle should remain unchanged: keep the tool local, visible,
limited, reversible where possible, and explicit about every account-changing
action.
