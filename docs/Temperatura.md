# Temperatura

The app that manages recipe steps by time and temperature

# Specification

This app allows you to create, edit, and save recipes. It also allows you to start any step of a recipe and it will monitor time and temperature for that step, giving alarms according to the settings in the recipe. An important feature is the ability to start more than one step at a time, from different recipes, the same recipe, even the same step from the same recipe (e.g. starting one loaf of bread to rise, then later starting a second loaf rising \- same recipe, same step, two instances running in parallel with different start/finish times).

## Style

A sans-serif font. Colour theme to be cool blues, based off the supplied icon background. The icon background is a gradient from about `#B1DCED` down to `#5CAADB`, dial face `#F7F4ED`, accent red `#C20104`. That's a *light* palette. Just the one palette for this MVP.

## Temperature monitoring

Temperature data comes from one or more **probes** connected via BLE. Several probes can be connected at the same time. Two kinds are supported:

* **FTHERM** — our own FeatherThermometer. Supplies temperature, battery level, and button press data. The button press data is used to cancel/silence alarms.
* **BBQ** — a commercial probe (Dialog DA14531 based, advertises as "BBQ"). Supplies temperature and battery level, but no button. It disconnects from Bluetooth while it is charging and reconnects when charging stops.

The user adds each probe once (it is remembered, with a name the user can change), connects and disconnects them from the Probes panel (the connect icon), and allocates a connected probe to a step that is in progress — see Probe assignment. The sections below say "the thermometer" when what they describe is true of any probe.

Wherever a current temperature is shown (Home, Recipe, Step), the battery level, if the probe reports one, is shown on the same line, right-justified, as a battery icon — not as a separate line, and not shown at all when there is no current-temperature line to attach to (i.e. never shown while disconnected). The icon turns red at 15% or below. A probe that reports no battery level simply shows no icon.

The Android Bluetooth stack limits how many devices can be connected at once, and each FTHERM accepts only one connection at a time (it stops advertising while connected). The app does not try to work around either limit.

## A recipe consists of

1. A recipe name  
2. A recipe description  
3. Any number of recipe text notes (added incidentally over time)  
4. Quantity/servings of this recipe  
5. An recipe ingredients list, a table of  
   1. Ingredient name  
   2. Quantity  
   3. Unit of measure  
6. Any number of recipe steps, each step comprises  
   1. A step name  
   2. A step description  
   3. Optionally a duration \- and a parameter that specifies which kind of duration it is, shown in the step editor as:
      * **Fixed length** — running time from Start.
      * **Time since entering band** — running time from the moment the reading first enters the temperature band. Once entered it keeps counting even if the reading leaves the band again; re-entering doesn't restart it (Restart does).
      * **Time spent in band** — the total time spent between the high and low temperatures of the band (stored as `inBand`; the editor used to call it "in temperature band").

      Both band kinds need a temperature band. In all three, paused time doesn't count.  
   4. Any number of time alarms (these are progress alarms) \- and for each time alarm a parameter that specifies is the alarm ‘one shot’ or ‘repeating’, and if repeating what the repeat interval is. Each time alarm has a name.  
   5. Optionally a temperature band (low temperature and high temperature)  
   6. Any number of temperature alarms (these are progress alarms) \- and for each temperature alarm a parameter that specifies is the alarm ‘heating’ or ‘cooling’ (heating alarms will only trigger if going from below to above the temperature, cooling alarms are the opposite). Each temperature alarm has a name.

## Journal

A recipe tends to be tweaked over time — ingredients, instructions, alarms — and the journal keeps a reference to go back to: what exactly was done last time, and how it turned out.

* **Record in journal** (Recipe page) saves an entry: the date and time, a complete copy of the recipe as it stands (name, description, notes, servings, ingredients, steps with their durations, bands and alarms), the ingredients multiplier in use, and the step tally marks (what was actually made). Later edits to the recipe never change an entry.
* **Journal** (Recipe page) opens a full-screen list of the recipe's entries, newest first, each showing its date and time and the start of its notes. Back closes it.
* Opening an entry shows its date, the multiplier and tallies it was recorded with, a **notes** box (e.g. "yield was 950 g; next time less salt"), saved on leaving the box, and the recipe as it was, laid out exactly like the PDF export and scaled by the multiplier it had then. Back returns to the list.
* An entry can be **deleted** (with a confirm).
* **Restore this version** puts the recipe back as it was in that entry — name, description, notes, servings, ingredients and steps; not the multiplier or tallies. The current version is recorded in the journal first (with a note saying so), so restoring never loses anything and can itself be undone the same way. It confirms first, and it is unavailable while any of the recipe's steps is in progress: the restored version might not have those steps, and a running instance must never be left on a step that no longer exists.
* Each recipe has its own journal. Deleting a recipe deletes its journal (the delete confirm says so). Backup/restore includes the journal; single-recipe export/import does not.

## Ingredients multiplier

An ingredient's quantity is entered as a plain decimal (e.g. `0.5`), a simple fraction (e.g. `1/2`) or a mixed number (e.g. `1 1/2`, a whole number and a fraction separated by a space) — all are accepted. A blank quantity is also allowed (e.g. an ingredient like "Salt — to taste" that has none); anything else is rejected at save time with a message explaining why.

The Recipe page's ingredients panel has a transient multiplier, defaulting to 1 (no scaling). It is per-recipe — each recipe remembers its own last-used multiplier independently, so scaling one recipe never affects another that happens to be open at the same time — and persists across closing and reopening that recipe, but it is stored separately from the recipe's own data (not part of its JSON, and not included in that recipe's JSON export/import).

Scaling a quantity by the multiplier follows the format the quantity was originally entered in:

* A **decimal** quantity always displays its scaled result as a decimal (e.g. `0.5` cup ×0.25 = `0.125` cup), however many decimal places that takes.
* A **fraction** or **mixed-number** quantity displays its scaled result as a fraction, written as a mixed number when it is more than 1 (`2 1/4`, never `9/4`; a whole result is just the whole number). The result is rounded two ways — to the nearest **1/64** (the spoons of a standard measuring set are 1, 1/2, 1/4, 1/8, 1/16, 1/32 and 1/64) and to the nearest **1/3** (1/3 cup is a standard measure) — and whichever rounding is closer to the unrounded amount is used, then simplified. A tie goes to the 64ths. Only if the result rounds to zero is it shown as a decimal instead, so a tiny amount is never hidden as "0". E.g. `1 1/2` ×2 = `3`, ×0.5 = `3/4`, ×0.3 = `29/64` (0.45: 29/64 is closer than 1/3), ×0.005 = `0.0075` (rounds to 0); `1/2` ×0.24 = `1/8`; `1/3` stays `1/3`; `1/2` ×0.67 = `1/3` (0.335: closer to 1/3 than to 21/64).
* Some measuring sets also have 1/6 and 1/12 spoons, so these are opt-in: with the **Sixths and twelfths** setting on (Settings — off by default), the second rounding is to the nearest **1/12** instead of 1/3, so results can come out in sixths and twelfths as well as thirds (`1/6`, `2 1/12`). With it off, `1/6` shows as `11/64`. The setting applies to the Recipe page and the PDF export alike.

The multiplier itself is always a plain decimal number, never a fraction.

The "Export as PDF" action (see below) reflects whatever multiplier is currently active for that recipe, so the shared copy matches what the screen was showing.

## Storage

IndexedDB as source of truth, "Open" means pick from a stored list. Plus JSON import/export of individual recipes as well as backup/restore all saved data. RTW's model, which is already working in storage.js

The set of open recipes is itself persisted, and is restored when the app restarts. It has to be: a running instance recovered after the app was killed belongs to a recipe, and without that recipe being open there would be no tile to display the instance under.

A recipe with one or more running instances is force-open. Its close button still appears, but tapping it warns the user that closing will complete all running instances of that recipe's steps, and closes only on confirmation.

Closing a recipe also clears its completion tallies (see "Completion tallies" under Recipe page) — they don't survive a close/reopen, so reopening a closed recipe always starts every step's tick count at zero.

### Export as PDF

Separate from the JSON export above (which is a machine-readable backup/import format), the hamburger menu also offers "Export as PDF" — a human-readable copy of a recipe, so it can be shared with someone who doesn't have the app. It renders the recipe (name, description, servings, notes, ingredients, and every step's name, description, duration/temperature band, and alarms in plain language) as a standalone HTML document opened in a new window, then invokes the browser's own print dialog — the user picks "Save as PDF" there. No PDF-generation library is involved or needed. Same act-on-current-recipe-else-picker behaviour as the JSON Export button.

## UX

1. ### Home page

Icon row at the top: open, new, search, hamburger, connect

* Hamburger: settings, import, export, backup, restore, help, about  
* Open: open a recipe from app local storage  
* New: create a new (blank) recipe  
* Search: free text search through all names and description of all recipes in storage  
* Connect: because this is an Android-only PWA the user must initiate the BlueTooth connection to a probe. The icon opens the Probes panel: a list of the probes the app knows about, each with its name, kind, connection state, current reading, battery level (if any), and the recipe step it is currently allocated to (if any), with Connect/Disconnect, Rename and Forget for each, and an "Add probe" button that opens the browser's device picker (listing both FTHERM and BBQ devices). The icon itself shows blue if any probe is connected, yellow while any is connecting or reconnecting, otherwise white. 

Current temperature (if any probe is connected): one line per connected probe, showing the probe's name and its raw reading. This is shown independent of any assignment - it is what the probe is reporting, not the temperature "for" any particular step.  
A collection of tiles, vertically stacked, one for each open recipe. Each tile contains

* Recipe name  
* Recipe description (restricted to three lines, with ellipsis if required)  
* A close button (if the recipe has running instances, closing requires confirmation and completes those instances - see Storage)  
* A sub-tile for each step that is currently in progress (i.e. has been started, but not yet completed, may be paused). Note: if the step is running more than once (parallel instances of the same step) each instance gets its own sub-tile. Each sub-tile contains  
  * Step name  
  * If the step has a tag, the tag name  
  * Step description (restricted to two lines, with ellipsis if required)  
  * If the step has a duration, a progress bar. For a band duration the bar also shows whether the time being accumulated is measured or assumed, and carries the estimate flag if it applies - see In-band accumulation.
  * The step's timers (see Step timers under the step page) — under the bar, or on their own when the step has no duration, marked "paused" while it is paused.

Tapping a tile causes the recipe page to appear, showing the recipe

2. ## Recipe page

Icon row at the top: home, edit, hamburger, connect

* Edit: all of the recipe components become editable \- tap a component to edit it, you can also add and delete ingredients and steps. Steps and ingredients are also draggable by a handle to reorder them — the step order set here is the order steps are listed in throughout the app (this page's own step tiles, and Previous/Next on the step page), and the ingredient order is the order they are listed in on the Recipe page, in the PDF export and in the JSON export.

Current temperature (if any probe is connected): one line per connected probe, raw readings, as on the home page.  
The main page contains

1. Name  
2. Description  
3. Notes  
4. Quantity/servings \- this is a label, not a dynamic calculator  
5. A panel for the ingredients — see Ingredients multiplier below  
6. A collection of tiles, vertically stacked, one for each step. Note: if the step is in progress more than once (parallel instances of the same step) there is only one tile for the step here. The contents of these tiles are not editable. Each step contains  
   1. Step name  
   2. Step description  
   3. Duration and temperature band  
   4. For each instance of the step currently in progress, a row the same as the home page's sub-tile — its tag if it has one, the progress bar if the step has a duration, and the step timers (marked "paused" while paused) — minus the step name and description, which are already the tile's own heading. Tapping a row opens the step page on that instance (as tapping a home page sub-tile does).  
   5. Completion ticks: a small mark in the bottom-right corner of the tile for every time this step has been completed. These accumulate indefinitely, with one exception — see "Completion tallies" below.  
7. Below the step tiles, these buttons:  
   1. **Clear all tallies** — zeroes every step's completion ticks for this recipe. Does not touch any running instance.  
   2. **Complete this recipe** — completes every instance of this recipe that is currently in progress (running or paused), leaving any not-started or already-completed instance untouched. Confirms first: "This will complete N running steps", with Cancel/OK; the back button cancels.
   3. **Record in journal** — saves a dated snapshot of the recipe to its journal (see Journal below). A line beneath the buttons confirms it was recorded.
   4. **Journal** — opens the recipe's journal.

Tapping a tile causes the step page to appear, showing the step and the step controls

#### Completion tallies

Each step's tick count is meant to answer "how many times has this gone through this step" at a glance — useful when several batches move through a recipe's steps in parallel. With the **Auto clear tallies** setting on (Settings — off by default), starting the recipe's first step clears every step's tally for the whole recipe, but only when doing so is unambiguous: no instance of any step in the recipe — including the first step itself — is currently in progress (running or paused). In the common case of working straight through a recipe and starting again once it's done, this means the slate is clear automatically, with no user action needed. With the setting off, tallies only ever clear when explicitly asked for — some users will prefer that simplicity, which is also why a fresh install starts with it off.

This check can't be perfect. A batch set aside between two steps (nothing currently running for it, but not finished either) looks idle to this check, so starting a fresh batch at step 1 at that moment would clear its history along with everything else. A step that is legitimately, deliberately skipped every time (e.g. a branch in the recipe that's never taken) never accumulates a tally of its own, but that's expected — a step with no completions has nothing to reset. For the cases the automatic check gets wrong, **Clear all tallies** is the manual override, and **Complete this recipe** is the fix for "I forgot to complete things as I went" — completing every still-running instance is exactly what makes the recipe idle, so starting step 1 next clears the tallies as expected.

## C. Step page

If more than one instance of this step is currently in progress, swipe left/right to see other instances.

Icon row at the top: home, edit, thermometer, hamburger, connect

* Edit: all of the step components become editable \- tap a component to edit it, you can also add and delete alarms  
* Thermometer: multiple steps can be in progress at one time, but each probe can only be in one place at a time, so this icon lets you choose which connected probe is used for this step. For example: you might be rising bread for a duration of 40 mins and a temperature band of 35-40 degrees, and coagulating tofu for a duration of 20 mins and a temperature band of 75-85 degrees, both simultaneously. With two probes you can give each step its own. With only one probe, if you use it for the tofu then the bread has to rise without temperature monitoring or alarms (but it will still get the ‘duration reached’ time alarm and any other time alarms). Even if you are doing two simultaneous batches of tofu, each needs its own probe to be monitored.

##### Probe assignment

A step instance **uses** at most one probe, and a probe is used by at most one instance (one-to-one). Which probe an instance uses decides which readings apply to it, for in-band accumulation and for temperature alarms. An instance that uses no probe is **unassigned**; this is the normal state for a step with no temperature interest, and a legitimate one for any other.

* When an instance starts, if it uses no probe and exactly one connected probe is not used by any in-progress instance, it automatically uses that probe. If there are no free connected probes it stays unassigned, and if there are several free ones it also stays unassigned (the app will not guess which one the user put in the pot) — the user chooses with the thermometer icon.
* A new instance never takes a probe away from an instance that is using it.
* If an instance that is using a probe ends (Complete), the probe becomes free. It is not handed on automatically. This must be allowed, because otherwise the app would be assuming the user physically moves the probe from one place to another the instant a step completes, which is not true.
* The thermometer icon on a step page opens a list of the connected probes. Each shows its name and current reading; one that another instance is using also shows which step. Choosing a probe makes this instance use it. Choosing "None" releases the one it is using.
* Choosing a probe that another instance is using **transfers** it to this instance (that instance becomes unassigned), because the user choosing it is the user telling the app they have physically moved the probe. The "never takes a probe" rule above governs automatic assignment at Start only, not a deliberate choice. Choosing a different probe for an instance that already uses one replaces it.
* A probe that disconnects stays assigned to its instance, so that when it reconnects the step carries on with it. Forgetting a probe releases it. Assignments are stored, so they survive the app being closed or killed, like everything else about a running instance.

The main page contains

A back arrow and a small heading showing the recipe's name, above the step name — either one goes back to the recipe page (the icon row's own Back icon is gone; this replaces it). To the immediate right of the step name, in normal body-sized text, "step X of Y" gives the step's position among the recipe's steps.

Current temperature (if connected): the reading from the probe this instance uses, labelled with the probe's name. On a step that is not yet started, it shows the reading from the probe that Start would automatically assign, if there is exactly one.

#### Step timers

Under the progress bar (or on their own when the step has no duration), a running step shows its timers on one line:

* A step with no temperature band shows its **elapsed** time — running time, excluding pauses.
* A step with a temperature band shows three: **elapsed**, **time since entering band** ("band not reached yet" until it has) and **time spent in band**, e.g. "12:30 elapsed · 8:10 since entering band · 6:45 in band". The one the step's duration counts against is in **bold**: elapsed for no duration or a fixed-length duration, otherwise the matching band timer. An estimated band figure carries '≈'.

The same line appears on the step page and on the home page's sub-tiles.

#### Temperature graph

While a step instance is in progress, the step page shows a live temperature–time graph of that instance, drawn as plain SVG (no charting library):

* **What is plotted:** the readings from whichever probe the instance uses, from Start. If the instance changes probe part-way, the line simply carries on with the new probe's readings. Any stretch with no probe or no data is a gap in the line, not a guess.
* **What is drawn with it:** the temperature band shaded, if the step has one, and a dashed line at each temperature alarm's threshold, so the readings can be seen approaching them.
* **Time axis:** the whole run so far, rescaling as it grows. Tapping the graph toggles to the last 10 minutes for close-up detail, and back.
* **Persistence:** the graph survives the app being killed or the phone rebooting, like everything else about a running instance: its points are stored with the instance, thinned to one point every 10 seconds, while the live end of the line still updates every second.
* **Long runs:** a step can run for days or months, so each instance keeps at most about 2,000 stored points. When that is reached, the oldest points are merged two into one — keeping each merged pair's highest and lowest reading, so a spike or dip is never smoothed away — and the whole run stays graphable at a coarser resolution.

#### Step controls

Start, Pause/resume, Restart, Complete, Duplicate, Extend

* Start: set the step to ‘in progress’ and allow the step’s alarms to trigger. If the duration is ‘fixed length’ start the timer running. If it is ‘time spent in band’ start counting time in temperature, and if outside the temperature band show a ‘waiting for temperature’ indicator. If it is ‘time since entering band’ show the same ‘waiting for temperature’ indicator until the reading first enters the band, then run the timer from that moment. Whether the instance is counting on live data or on assumption is shown throughout - see In-band accumulation. Once the step is started a tag name can be entered.  
* Pause/resume: pause, then resume the timer. The step remains in progress while paused. Time alarms cannot trigger because the timer is not running, but temperature alarms can trigger because the step is in progress.  
* Restart: reset the timer to zero and start it running again. The step remains in progress. Any time alarms that have already triggered can now trigger again, and so can any one-shot ("once") temperature alarm.  
* Complete:  set the step to ‘not in progress’, no more of the step’s alarms will trigger.  
* Duplicate: Start another instance of this step  
* Extend: add time to this instance’s duration without editing the recipe — see Extending a duration.
* Previous / Next: when no instance of the step is in progress, Previous and Next sit either side of Start and go to the previous / next step of the recipe. Previous is greyed out on the first step. On the last step, Next is replaced by **Complete recipe**, which goes back to the recipe page and does what that page's "Complete this recipe" does: if any of the recipe's steps are in progress it opens that confirm ("This will complete N running steps", Cancel/OK); if none are, it just returns to the recipe page.
* Which of these is the main (large) button: Start, unless the step has a tally mark (it has been completed since the tallies were last cleared — see the recipe page). Then the likely next action is moving on, so Next — or Complete recipe on the last step — becomes the main button and Start a small one.

#### Extending a duration

Available on the step page next to the duration, whenever the step has a duration and an instance is in progress (running or paused). Also offered as an action on a duration-reached alarm’s notification, alongside Silence.

Tapping Extend: silences the duration-reached alarm if it is currently sounding, then opens a dialog asking how much time to add, using the standard time-entry control below. The dialog explains: “This is a temporary extension — if you want to extend the duration permanently you need to edit the recipe step.”

* The extension applies to this one instance only. The recipe step’s own duration is never changed, and no other instance of the same step is affected.  
* Extending is cumulative — extending twice adds both amounts together.  
* If the duration-reached alarm already fired, extending re-arms it so it can fire again once the new, later duration is reached. Elapsed time itself is untouched — extending only moves the target further away, the same way it never resets when paused and resumed.  
* Restarting the instance clears any extension, the same way it clears everything else about the previous run.  
* From the notification: tapping Extend brings the app to the foreground so the dialog can actually be answered, unlike Silence which needs no app window at all.
* If the duration-reached alarm is currently **missed** (see "Missed status" under How alarms work), extending is not cumulative with the stale target — instead the new target becomes *now* plus the entered extension, since the original target has already passed unacknowledged, possibly a long time ago. E.g. a duration reached an hour ago, extended by 5 minutes, effectively becomes +65 minutes (an hour late, plus the 5 minutes just added) — not a pointless +5 minutes on a target already an hour in the past. A normal (not-yet-missed) extend keeps the ordinary cumulative behaviour above.

#### Time entry

Every duration a user types anywhere in the app — a step's duration, a time alarm's trigger point into the step, a time alarm's repeat interval, and how much time to add on Extend — uses one standard control: three boxes for hours, minutes, and seconds, separated by colons, each showing `00` at zero (plus a days box when needed — see Days below). This replaced an earlier mixture of ad hoc minutes-only and seconds-only fields across different screens.

This does not apply to an alarm theme's ramp or repeat-interval-of-silence (Settings) — those are short audio parameters measured in a handful of seconds, not a step-timing duration, and stay plain seconds fields. An alarm theme's "Silence after" field is the exception: despite living in the same Settings card, it is a real duration (default 2 minutes, plausibly several) rather than an audio microparameter, so it does use the standard control.

#### Days

Steps can last from minutes to months (a long ferment, a cure, an ageing cheese), so durations support **days** as well as hours, minutes and seconds — without cluttering the common case, where nearly every step is minutes or hours long. Days is the largest unit; there are no months.

* **Display.** Under 24 hours nothing changes (`5:00`, `2:15:00`). From 24 hours a day count goes in front, and seconds are dropped — a ticking seconds digit on a multi-day step is clutter, not information: `3d 4:05` (3 days, 4 hours, 5 minutes). This applies everywhere a duration or a running time is shown: the step timers, remaining / extra time, the step's own duration, the tiles, Extend, and the PDF export. The alarm overlay's fixed-width form follows the same rule: `(time 00:05:00)` under a day, `(time 3d 04:05)` from a day.
* **Entry.** The standard control gains a **days** box, to the left of the hours box, that is hidden until needed:
  * Typing 24 or more into the hours box rolls the excess over into days (36 hours becomes 1 day 12 hours), and the days box appears.
  * A small "+ days" link beside the boxes reveals the days box directly, for typing "14 days" straight in.
  * Once shown, the days box stays for as long as the value is a day or more.
  Seconds can still be entered on a multi-day value; they just aren't displayed.

#### Step components

1. Step tag name (if step is in progress)  
2. Step name  
3. Step description

#### Step parameters and alarms

* Duration  
* Fixed length or temperature in band  
* Duration reached alarm  
  * Enabled or disabled (per step)  
  * Alarm theme  
* Time alarms  
  * Name  
  * Time  
  * One-shot or repeating  
    * Repeat interval  
  * Alarm theme  
* Temperature band (min and max)  
  * Whenever a temperature band is set, two implicit alarms always exist: a cooling alarm at
    the band's low temperature and a heating alarm at its high temperature. These cannot be
    disabled, only individually themed (per-band-edge alarm theme) — they exist for as long as
    the band does.
* Temperature alarms  
  * Name  
  * Temperature  
  * Heating or cooling  
  * Once or every time (a two-way switch labelled "once" / "every time"; "once" makes the
    alarm **one-shot**). Defaults to every time, and an alarm saved before this option existed
    is every time. The band's two implicit alarms are always every time and have no switch.
  * Alarm theme

On the step page's list, a one-shot temperature alarm's description ends with "(once)"; every other alarm reads as before.

Wherever a step's alarms are listed as a group — the step page's own list, and the order alarms are edited in — they appear in one canonical order: time alarms ascending by trigger time, then the duration-reached alarm, then heating temperature alarms ascending by threshold, then cooling temperature alarms descending by threshold, then the temperature band's two implicit alarms. A newly-added alarm is appended at the bottom of its own list while you're still editing (so adding one doesn't jump around mid-edit) and reflows into its sorted position the moment you leave the editor.

## Settings

Alarm themes: each alarm theme consists of

* Alarm theme name  
* Sound file, user picks from their file system  
* Ramp \- how many seconds to take for the sound to go from silence to full volume (device media volume)  
* Repeat interval \- how many seconds of silence to leave between repeats of the sound while the alarm is sounding  
* Vibrate \- whether or not to vibrate for this alarm. A boolean, not a pattern: the vibration pattern itself is fixed in code (see How alarms work).
* Silence after \- how long an alarm sounds unanswered before it goes to missed status (see "Missed status" under How alarms work). Entered with the standard hours:minutes:seconds control. Default 2 minutes.

User can create, edit, and delete alarm themes.

There is also an alarm theme for lost BLE connection.

#### Sound files

* Only MP3 is accepted, 5 seconds maximum length. Longer files are rejected at pick time with a message saying why.
* The picked file is decoded once and stored in IndexedDB as an ArrayBuffer, alongside the theme. It is NOT stored as a `FileSystemFileHandle`: an alarm must be playable while the app is hidden, with no user gesture and no permission prompt available, so the audio has to be owned by the app rather than referenced on the device's filesystem.
* Playback goes through `decodeAudioData` on the keep-alive `AudioContext`, not an `<audio>` element. That context is already resumed and already holding a media session, so it is the one audio path proven to survive backgrounding on this platform.
* The ramp is a `linearRampToValueAtTime` on a gain node, from silence to 1.0 (which is device media volume) over the theme's ramp seconds.
* The decoded buffer repeats until the alarm is silenced, with the theme's repeat interval as silence between each play — not a seamless native loop, since that would leave no way to configure a gap. If ramp is non-zero the ramp runs once, on the first pass, not on every repeat.
* If decoding fails at any point, including at play time, fall back to the built-in synthesised tone (below) and log it. An alarm must never fail silently.

#### Bundled defaults

A fresh install has no user-supplied sound files, so the app ships with one built-in theme whose sound is synthesised in code (oscillator based, as in Manawa Pace) rather than a bundled MP3. It is:

* the default theme for every new alarm,
* the default theme for the lost-BLE-connection alarm,
* the fallback when a user theme's audio fails to decode.

It cannot be deleted. Its ramp, vibrate, and silence-after settings can be edited.

## How alarms work

If a step starts already above a heating alarm's threshold, no crossing ever occurs, so it never fires. Same for cooling alarms starting below threshold.

Temperature alarms judge the reading rounded to the nearest 0.1 °C — the resolution the app displays — so an alarm always agrees with the number on screen. Against a threshold T a rounded reading is above T, below T, or exactly at T, and exactly at T counts as neither side.

* A **heating** alarm at T fires when the reading goes above T (e.g. 70.1 for T = 70) having not been above it. A **cooling** alarm is the mirror: it fires when the reading goes below T having not been below it.
* A **one-shot** ("once") temperature alarm fires at most once per run of the step. Only Restart re-arms it (see Restart), and even then it needs a real crossing from wherever the reading is at that moment.
* An **every time** temperature alarm re-arms after firing, with hysteresis, because a reading jitters across a threshold (the DS18B20 resolves 0.0625 °C). The count starts at a reading back on the other side of T — below T for heating, above T for cooling — by any amount. It then needs **5 readings in a row, or 5 seconds, whichever comes first, without any reading going over the threshold again** (above T for heating, below T for cooling; a reading exactly at T is not over it, so it doesn't cancel the count and does count towards it). Any reading over the threshold cancels the count, and it starts again from the next reading back across. Every reading is checked, including ones that arrive between the app's once-a-second alarm evaluations. A loss of live data also cancels the count, and readings from during the gap are ignored (time nobody observed doesn't count). Both limits exist because probes differ: an FTHERM reports about 1.3 times a second, so 5 readings re-arm it in about 4 s, while a BBQ only reports when its value changes, so for it the 5 seconds is what usually applies. It cannot fire again until it has re-armed.

This hysteresis applies to alarms only. It does NOT apply to the temperature band used for in-band accumulation - band entry and exit are evaluated on the raw reading against the band's low and high values, with no hysteresis. Jitter at 0.0625 °C resolution costs milliseconds of accumulated time either way, which does not matter.

When an alarm triggers it causes a notification, plays the sound, and triggers the system vibration. Because this is an Android PWA it is necessary for the app to register itself as a media player, and to continually play a near silent audio file. This not only allows the alarm audio files to play, but it also means the BLE data keeps flowing when the app is backgrounded. If the BLE data stops flowing an entirely separate (configured in the app settings from the hamburger icon) alarm must sound to alert the user that the temperature data is not flowing.

#### When an alarm is triggered

The user can silence the alarm by short-pressing the button on the thermometer, by tapping the ‘silence’ button in the app, or by interacting with the alarm's notification (see Notifications below - this is the only phone-side path available while the app is backgrounded). That silences the alarm, although it may re-trigger while the step is in progress, e.g. if the temperature goes up past a heating temperature alarm that triggers the alarm. The user silences it, but then the temperature drops below that alarm temperature, the next time it goes up past the temperature it will trigger again.

A button press can only silence one alarm. If multiple alarms are firing the button press silences the earliest one to fire. Three simultaneous alarms requires three presses. 

For a repeating alarm, silencing kills the one occurrence that is sounding, it does not cancel the repeats.

A repeating alarm never sounds in a burst. When several of its occurrences are due at once — it was added to a step that has already been running for a while (it counts from its first occurrence, as any alarm added for a time already passed fires), or the app was closed for a long spell — they fire together as **one** alert. And when an occurrence comes due while the previous one is still unanswered (sounding or missed), it folds into that same alert rather than standing alone. The alert keeps count of how many occurrences it stands for; one Silence or Dismiss answers them all, and the count starts again from the next occurrence. E.g. an every-minute "Stir" alarm added two hours into a step sounds once, as "Stir (every 1:00 for 120x)". A single, non-repeating time alarm added for a time already passed simply fires straight away, once.

#### Missed status

An alarm left sounding for its theme's "Silence after" duration with nobody acknowledging it goes to **missed** status: audio and vibration stop, but the alarm stays outstanding rather than quietly going back to idle. This applies uniformly to all three alarm kinds (time, temperature, and the implicit data-loss alarm), and the countdown to missed runs on real wall-clock time regardless of whether the step is paused.

A missed alarm is cleared one of two ways:

* **It is dismissed.** A distinct action from silencing, since a missed alarm has nothing currently sounding to silence.
* **It retriggers on its own.** A repeating time alarm's next interval, an every-time temperature alarm's next crossing after re-arming, and the data-loss alarm's next loss episode after reconnecting, all fire and sound again even if the previous occurrence was left missed and never dismissed — and that retrigger implicitly clears the earlier missed status (there is only one slot of runtime state per alarm, no history of separate occurrences, so the fresh occurrence simply replaces the stale one). This is deliberate: the point of a repeating alarm is that a missed occurrence must never hold up the next one — a 5-minute repeat with a short silence-after must keep repeating every 5 minutes even if the user never reaches the phone in time to dismiss any given occurrence, or the whole feature would be self-defeating.

A **one-shot** time alarm, a **one-shot** temperature alarm and the **duration-reached** alarm are the exception: none of them ever fires again on its own once it has fired (one-shot by definition, until Restart; duration-reached unless re-armed via Extend or Restart), so dismissing is the only way to clear their missed status.

Restart clears missed status for every alarm on the step, including temperature alarms (which Restart otherwise leaves alone) — a restart is a fresh run of the step, and a stale missed flag would otherwise permanently block that one alarm with no other way to clear it.

#### The alarm overlay

Every currently sounding or missed alarm, across every open recipe and every running instance, is shown in one overlay that sits on top of everything else in the app — including an open recipe or step editor. Each row shows the recipe name, step name, alarm name, and the instance's tag if it has one. There is no way to close the overlay directly: it disappears only once every row has been resolved (silenced if sounding, dismissed if missed), one at a time or in any order.

The alarm name carries a parenthetical qualifier naming its kind and value, so a row is legible without opening the step: a time alarm (including the duration-reached alarm) reads `(time HH:MM:SS)`, a heating temperature alarm `(heating N deg)`, a cooling one `(cooling N deg)`. A repeating time alarm additionally carries which occurrence this is — `(#3 time HH:MM:SS)` for its third firing — numbered from its first occurrence (`#1`), not just from the second onward. When the alert stands for several unanswered occurrences (see above) it reads `(every 1:00 for 120x)` instead, and so does its notification.

A row for the duration-reached alarm also carries an **Extend** button beside Silence/Dismiss — the same rule the step page's own Extend button already follows (available whenever the step has a duration). Extending a missed duration alarm from the overlay uses the same "from now, not from the stale target" math described above.

The thermometer button and the Android back button both resolve the single earliest outstanding alarm across every instance (silencing if it's sounding, dismissing if it's already missed) — the same "earliest first" rule as before, just spanning both states now. Both are swallowed with no effect if nothing is outstanding.

Each FTHERM keeps its own press-count baseline, and a press from any FTHERM does the same thing: it resolves the single earliest outstanding alarm across every instance, whichever probe sent the press and whichever instance (if any) that probe is assigned to. A BBQ probe has no button.

Press-count arithmetic: if presses are received when no alarm is sounding, they are swallowed. If one alarm sounds, and the user presses twice, the alarm is silenced and the second press is swallowed. When the counter wraps or a cold restart of the Feather we will see the count go down instead of up. Treat the count going down as a single button press.

The press count is a uint8 in the MEASUREMENT packet, so what the app acts on is the difference between consecutive packets, not the absolute value. That difference is only meaningful within a continuous stream of packets:

* On first connect the app has no previous count. **Seed** the baseline from the first packet and act on nothing. Do not treat the first packet's value as N presses.
* On any reconnect, **seed** again from the first packet after the gap. Do not apply the difference across the gap. The difference might be +4, but there is no way to know how those four presses interleaved with alarms firing, silencing and re-arming while the app was blind, so applying it would silence four alarms for reasons the user cannot see.
* Only apply differences between packets that arrived back to back within one unbroken connection.

Presses made while disconnected are therefore lost. That is correct: the thermometer has no idea what is sounding on the phone, and a press the app did not witness in context cannot be attributed to an alarm.

#### Restart

Restart re-arms all time alarms, including the duration-reached alarm, and every one-shot temperature alarm (a restart is a fresh run of the step, and a one-shot alarm fires once per run). Every-time temperature alarms are not affected because they re-arm themselves by temperature, not time — except that Restart does clear a temperature alarm's missed status, same as every other alarm (see "Missed status" above).

#### Notifications and vibration

On Android, `navigator.vibrate()` is ignored when the document is hidden, and an in-progress vibration is cancelled by the visibility change. Vibration while backgrounded is therefore only reachable through the `vibrate` option on a service-worker notification. See ble-hr-tool.zip (Manawa Pace) for a working example of a system vibration firing while the app is backgrounded: `triggerNotification()` in app.js routes to the service worker, and the `message` handler in sw.js calls `showNotification` with the pattern.

Alert routing follows that example, and nags on the same 5-second cadence (see Notification
lifetime, below) regardless of visibility — visible and hidden should feel the same to the
user. Only the delivery mechanism differs, because of the platform constraint above:

* **App visible:** every 5 seconds, vibrate directly with `navigator.vibrate(pattern)`. No
  notification is needed, because the app itself is on screen with a silence button.
* **App hidden:** every 5 seconds, post to the service worker, which (re-)shows a notification
  carrying the vibration pattern — this is the only path available since `navigator.vibrate()`
  is ignored while hidden. The audio plays through the keep-alive `AudioContext` either way,
  continuously, regardless of visibility.

The vibration pattern is fixed in code, one pattern for all alarms. The per-theme Vibrate setting only decides whether it is used.

##### Notification lifetime

An unsilenced alarm nags every 5 seconds, whether the app is visible or hidden, until it is silenced or goes to missed status (see "Missed status" above). A notification only vibrates at the moment it is posted, so while an alarm is sounding and the app is hidden, its notification is **re-posted every 5 seconds** to carry that same cadence through — each re-post fires the vibration again, which is what makes a phone in a pocket keep nagging. While visible, the same 5-second cadence is delivered by calling `navigator.vibrate(pattern)` directly instead, since there is no notification to re-post.

A notification stays up until one of:

* the alarm is silenced, by any of the three routes,
* it is replaced by the next re-post of the same alarm (use a stable per-alarm `tag` so a re-post replaces rather than stacks),
* the user interacts with it, which silences the alarm.

It does not auto-close on a timer. This is the opposite of Manawa Pace, whose notifications are transient state-change cues and are closed after a few hundred milliseconds; Temperatura's notifications represent a condition that persists until the user deals with it, so `requireInteraction: true`.

##### Silencing (or dismissing) from the notification

The notification is the only phone-side path available while the app is hidden, so it must accept the interaction — and it must accept the right one, since a missed alarm has nothing sounding to silence:

* A still-sounding alarm's notification carries a **Silence** action; a missed alarm's carries **Dismiss** instead. Tapping the notification's body (not an action button) does the same as whichever of the two currently applies.
* The service worker's `notificationclick` handler posts the resolution to any live client. If no client is alive, the notification still closes, but nothing is recorded for later — the instance's alarm state is unaffected, and it's simply re-evaluated normally (sounding, or by then possibly missed) the next time the app opens and its tick loop runs.
* Resolving from the notification is identical in effect to a thermometer button press or the in-app overlay: it applies to exactly the one alarm the notification belongs to, and silencing does not cancel a repeating alarm's future repeats.
* A notification for a resolved alarm is closed immediately and not re-posted.

If several alarms are sounding, each has its own notification and its own tag, so each can be silenced independently. This is the one place where the phone-side path is better than the thermometer button, which always silences the earliest alarm to fire.

## In-band accumulation

Every step with a temperature band **starts out of band**, and is only ever counted as in band on the strength of a **real in-band reading**. It makes no difference why there is no reading — no probe assigned, no probe connected, or a probe that simply hasn't reported yet: until a real reading shows the temperature in the band, the instance counts no in-band time and has not entered the band, and its bar shows 'waiting for temperature – no data'.

Once there has been at least one real reading, losing the data (the BLE connection drops, the probe is taken by another instance, the reading becomes unusable) carries the last real state on: the instance continues to count in-band if the last reading was in band, and stays out of band if it was out of band, until live data returns.

(This replaces an earlier rule that assumed in band from the start when a step had no thermometer at all, so that a probe-less step would still progress. That handed out in-band time, and band entry, that no reading had ever shown.)

#### Starting the in-band timer by hand

Two situations leave a band step with no data, and the rules above serve both:

1. **The probe isn't connected (or assigned) yet.** Because nothing counts until a real reading, there is time to notice and fix it without the step's clock having run.
2. **The step is watched on a thermometer the app can't read** (a non-Bluetooth thermometer, or none at all). No reading will ever arrive, so the user says when it's in the band.

For the second, the step page shows a **Start in-band timer** button whenever the step is running, has a temperature band, has no live data coming in, and is out of band. Pressing it settles the time so far as out of band, then puts the step in band, where it stays for as long as there is no data — both band clocks run (a 'time since entering band' step enters the band at that moment). It is still an assumption, not a measurement: the bar is hatched and advancing, captioned "in band — set by hand", and in-band time carries the '≈' estimate flag.

The first real reading takes over and ends the manual state, in or out of band as the reading says; if data is then lost again, the last real state carries on (and if that is out of band, the button is offered again). Restart clears it.

#### Measured vs assumed time

The rules above mean an instance can accumulate in-band time on assumption rather than on measurement, and the user must be able to see which. Otherwise an 'in temperature band' step whose probe is elsewhere behaves indistinguishably from a 'fixed length' step, and an instance that was out of band when the data stopped sits frozen forever with nothing on screen to say so.

At any moment an instance with an 'in temperature band' duration is in one of two provenance states:

* **Measured** – this instance uses a probe, that probe's data is fresh (see "Data freshness" under Bluetooth specification), and the reading is valid (probe present, not the 0x8000 sentinel for an FTHERM). In-band or out-of-band is being decided by live data.
* **Assumed** – anything else: no probe is assigned, the probe's connection is down, or the reading is unusable. In-band or out-of-band is being carried forward per the rules above — and before the first real reading that always means out of band.

This gives four progress bar states, and they must be visually distinct:

1. Measured, in band – solid fill, advancing.
2. Measured, out of band – solid fill, not advancing, with the 'waiting for temperature' indicator.
3. Assumed, counting – hatched fill, advancing. The bar is moving on an assumption, not a measurement.
4. Assumed, not counting – hatched fill, not advancing, with a 'waiting for temperature – no data' indicator. This is the silent-stall case and it must not look like a step that is simply waiting on a live reading.

An instance with a 'fixed length' duration is always measured and always renders solid. Time is never in doubt.

An instance with a 'time since entering band' duration is in these same states until the reading first enters the band (waiting for temperature, live or with no data). Band entry only ever happens on a real in-band reading. Once it has entered, its clock simply runs — leaving the band doesn't stop it — so it always advances: solid while live data is coming in, hatched while it isn't, so the bar still shows that the probe has gone quiet even though the count itself is not in doubt.

##### The estimate flag latches

Once an instance has accumulated any in-band time while assumed, it is flagged as estimated for the rest of its life, even if it later regains the probe. Its accumulated total is partly assumption from then on and cannot be un-assumed. A 'time since entering band' figure is never an estimate: entry only happens on a real reading, and after that it is plain running time. Show the flag next to the estimated timer (see Step timers) on the step page and on the home sub-tile - an '≈' marker is enough, with the reason available on the step page.

#### Pause

Pause: temperature alarms still fire, time alarms don't. In-band accumulation pauses.

#### Restart

Restart sets the accumulation to zero, and sets 'time since entering band' back to not yet entered.

#### Time alarms and the duration-reached alarm run on the same clock as the progress bar

A step's time alarms and its duration-reached alarm never advance against a clock other than the
one its own progress bar shows, so a step can never report "duration reached" while its own
progress bar disagrees:

* No duration, or a **'fixed length'** duration: running time only (excludes pauses), regardless
  of whether the step also has a temperature band. This is what "time is never in doubt" for a
  fixed-length duration means in practice — a temperature band on a fixed-length step drives its
  temperature alarms and band-boundary alarms, but has no say over its timing.
* A **'time spent in band'** duration: the same in-band accumulation the progress bar shows.
  Time spent out of band does not count towards a time alarm's trigger point or towards the
  duration-reached alarm, no matter how much wall-clock time has passed.
* A **'time since entering band'** duration: running time since the band was first entered, the
  same figure the progress bar shows. Nothing counts before the band is reached, and everything
  (except pauses) counts after.

Extend adds to the target on the same clock.

Paused: neither clock advances, per Pause above.

## Editing a step/instance while it is running

* If a step has a running instance, the step cannot be deleted.  
* A step can be edited, but if there is more than one instance running a warning dialog shows advising the user that all instances in progress will be affected by edits. Edits take effect immediately, but not all new or changed alarms will fire, e.g. a new time alarm in the past will never fire, a heating alarm at a temperature we have already passed will never fire.

## Calibration

Deliberately out of scope for this MVP.

## Keep awake and recovery

The user may want to watch the phone for some time (maybe hours) so it is essential that the app uses keep-awake when it is visible. 

Running instances survive the app being killed. A 40-minute rise or a 6-hour ferment will outlive Chrome discarding the tab or a phone reboot. RTW has recording-recovery-spec.md for exactly this problem. Temperatura needs the same, and it implies every timer is derived from stored epoch timestamps (startedAt, pausedAt, accumulated-in-band-ms), never a tick counter.

## Bluetooth specification

Each kind of probe has a **driver**: the picker filter and service it needs, how to read its data, and what it can report. Every probe is a separate GATT connection, managed independently (connect, reconnect, data freshness). Manage the device back button as in RTW (backGuard.js) to get user to confirm before exit.

#### Probe kinds

**FTHERM.** See the file FeatherThermometer.ino for details. Use GATT. Subscribe to the 8-byte custom MEASUREMENT characteristic (`b7e1c0a0-4f3d-4a21-9f3e-6c1a2d5b7e02`) of service `b7e1c0a0-4f3d-4a21-9f3e-6c1a2d5b7e01`. Picker filter: name starting `FTHERM`. Reports temperature, battery, button presses and probe presence. Data is a steady stream (about 1.3 Hz).

**BBQ.** Commercial probe, name "BBQ", Dialog Semiconductor DA14531. Advertises service `18424398-7cbc-11e9-8f9e-2a86e4085a59`, which is also its picker filter (the name alone is too generic to filter on). Use GATT. Subscribe to the single notify characteristic `772ae377-b3d2-ff8e-1042-5481d1e03456`. Each notification is raw bytes: the **first byte is the battery level as an 8-bit integer, 0 to 100** (it only looks like a letter in a hex dump — 0x64 is 100%, shown as `d`, and 0x57 is 87%, shown as `W`; it must be read as a number, never as text), and **the rest is the temperature in °C as an ASCII decimal string**, e.g. `64-31-37-2E-36` is 100% and 17.6 °C. A first byte above 100 is not a percentage, so no battery level is reported for that notification; a remainder that is not a decimal number counts as "no data". Reports temperature and battery only. **It notifies when the value changes, not at a steady rate** — silences of 40 seconds or more were observed with the temperature steady — but it does send a reading when the connection is made. There is no "probe unplugged" state: charging is what makes it disconnect (see Disconnect and reconnect).

**BBQ dip filter.** The BBQ's readings periodically come in low by about 1.6 °C for exactly one notification, never two in a row, then recover. Left alone each dip would cross band edges and fire temperature alarms for a temperature the food never had, so BBQ readings are filtered before anything — the display, in-band accumulation, temperature alarms — sees them:

* A reading more than 0.9 °C below the previous reading (strictly more; ordinary reading-to-reading change is 0.1–0.3 °C) is suspected to be a dip: the previous value stays shown.
* The reading straight after a suspected dip is never itself suspected, so a genuine sustained drop gets through on its second reading.
* Every other reading is shown as the average of itself and the last reading used, which smooths noise at little cost in responsiveness. The first reading after a connection is shown as it is.
* Because the BBQ only notifies on change, a genuine drop is followed by no further reading at all. A suspected dip that nothing contradicts within 5 seconds (a real dip's correction arrives about 1.6 s later) is accepted as the true reading, otherwise the display would stay stuck on the old value.
* Reconnecting starts the filter afresh, so nothing held before a charging gap survives it.

The FTHERM is not filtered.

The picker (`requestDevice`) offers both kinds at once: the filters are the union of the drivers' filters, and every driver's service is listed in `optionalServices`. The custom 128-bit UUIDs must be listed there or the services cannot be accessed.

#### Connecting

Connect always requires a user gesture, but it does not always require the device picker. Follow the three-tier path in ble-hr-tool.zip (Manawa Pace), in the `connectBtn` click handler, **per probe**:

1. **Already connected.** If a device reference is held for that probe and `gatt.connected` is true, just restore the UI. Do not reconnect.
2. **Previously paired.** Call `navigator.bluetooth.getDevices()` and pick out the device whose `id` matches the probe's remembered device id (never just the first device returned — several probes may have been permitted). Use the gesture to drive `gatt.connect()` on it directly, retrying up to 3 times at 3 second intervals, since a probe may take a few seconds to start advertising again after a disconnect. This is the path that matters after Chrome has discarded the tab mid-ferment: the user taps Connect once and is back on the same probe with no device list.
3. **Picker.** Only if the probe is new, or the above finds nothing or fails, call `requestDevice()`. Clear any stale non-connected device reference first, because some browsers block the picker while an abandoned reference is still held. Adding another probe needs its own tap and its own picker, because the picker returns one device per call. When the picker was opened from a known probe's **Connect**, the device picked **becomes that probe**: it keeps its name and assignment, and its remembered device id is updated. The one exception is a device already connected as another probe, which stays that probe.

So a page reload loses the JS device references but not the browser's permission for the devices, and Connect after a reload should not show the user a picker — where `getDevices()` exists. On Android Chrome without its persistent-permissions backend it does not, so every Connect falls through to the picker, and the picker gives the same physical probe a **different device id each session**. That is why a probe's identity is the app's own id, never Chrome's device id: the device id is only a remembered hint, replaced whenever the user connects the probe through the picker. (Keyed by device id, every reconnect created a new "BBQ 2", "BBQ 3"….)

The app remembers each probe it has connected to (its own id, its last device id, kind and a name the user can change; the first FTHERM is named "FTHERM 1", the first BBQ "BBQ 1", and so on). Forgetting a probe removes it from that list and releases it from any step using it.

#### Disconnect and reconnect

Listen for `gattserverdisconnected` on every probe. On an unexpected disconnect while any instance is running, retry `gatt.connect()` on that probe on a backoff, as Manawa Pace does; a long press on an FTHERM's button is a legitimate power-off, so give up after a bounded number of attempts and null the device reference so the next Connect starts clean. Every (re)connect re-seeds that probe's press-count baseline (see How alarms work). One probe dropping does not affect the others. A BBQ that goes away to charge will normally outlast the bounded retries; when charging stops, the user taps Connect for it in the Probes panel (a previously permitted probe reconnects without the picker).

#### Data freshness

Whether a probe's data is **fresh** is decided per kind, because a steady stream and a notify-on-change stream mean different things by silence:

* **FTHERM** (steady stream): fresh while a MEASUREMENT packet has arrived within the last 5 seconds.
* **BBQ** (notify-on-change): fresh for as long as the connection is up. Silence only means the value has not changed. Once the connection drops it stops being fresh after the same 5 seconds, counted from the disconnect.

Everything below that talks about "no packet for 5 seconds" or "lost data" means "not fresh" in this sense.

#### BLE-data-loss alarm

The timeout is 5 seconds without fresh data from the probe an instance uses (see Data freshness).

The alarm fires only when the missing data would actually change something, i.e. when all of the following hold:

* an instance is running, and
* that instance uses a probe, and
* that instance has a temperature band or at least one temperature alarm.

If the instance uses no probe, or it has neither a temperature band nor any temperature alarms, no BLE-data-loss alarm is fired. An unassigned instance is a normal state (see Probe assignment), not a fault, so it must not nag. A probe that is not assigned to anything never raises the alarm either.

When the probe is absent (FTHERM flags bit0) or temperature reads the 0x8000 sentinel, or a BBQ notification can't be read, show ‘no data’ where the temperature would be displayed. Note this is distinct from data loss: the connection is fine, but there is no usable reading. In-band accumulation treats it exactly as it treats a lost connection - carry on with the last known in-band or out-of-band state.

## History

No history for this MVP.

## Programming style

Refer to ride-the-wind.zip. Follow the example of how to organise the repo, the use of tests, and the platform/libraries used. Obviously the UX is very different, but stylistically the Ride the Wind project should act as a guide.