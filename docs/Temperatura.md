# Temperatura

The app that manages recipe steps by time and temperature

# Specification

This app allows you to create, edit, and save recipes. It also allows you to start any step of a recipe and it will monitor time and temperature for that step, giving alarms according to the settings in the recipe. An important feature is the ability to start more than one step at a time, from different recipes, the same recipe, even the same step from the same recipe (e.g. starting one loaf of bread to rise, then later starting a second loaf rising \- same recipe, same step, two instances running in parallel with different start/finish times).

## Style

A sans-serif font. Colour theme to be cool blues, based off the supplied icon background. The icon background is a gradient from about `#B1DCED` down to `#5CAADB`, dial face `#F7F4ED`, accent red `#C20104`. That's a *light* palette. Just the one palette for this MVP.

## Temperature monitoring

Temperature data comes from the FeatherThermometer via BLE connection. The BLE connection supplies temperature, battery level, and button press data. The button press data is used to cancel/silence alarms. 

Wherever the current temperature is shown (Home, Recipe, Step), the battery level is shown on the same line, right-justified, as a battery icon — not as a separate line, and not shown at all when there is no current-temperature line to attach to (i.e. never shown while disconnected). The icon turns red at 15% or below.

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
   3. Optionally a duration \- and a parameter that specifies is the duration ‘fixed length’ or ‘in temperature band’ (‘in temperature band’ means the duration represents the total time spent between the high and low temperatures specified in the temperature band)  
   4. Any number of time alarms (these are progress alarms) \- and for each time alarm a parameter that specifies is the alarm ‘one shot’ or ‘repeating’, and if repeating what the repeat interval is. Each time alarm has a name.  
   5. Optionally a temperature band (low temperature and high temperature)  
   6. Any number of temperature alarms (these are progress alarms) \- and for each temperature alarm a parameter that specifies is the alarm ‘heating’ or ‘cooling’ (heating alarms will only trigger if going from below to above the temperature, cooling alarms are the opposite). Each temperature alarm has a name.

## Ingredients multiplier

An ingredient's quantity is entered as either a plain decimal (e.g. `0.5`) or a simple fraction (e.g. `1/2`) — both are accepted. A blank quantity is also allowed (e.g. an ingredient like "Salt — to taste" that has none); anything else is rejected at save time with a message explaining why.

The Recipe page's ingredients panel has a transient multiplier, defaulting to 1 (no scaling). It is per-recipe — each recipe remembers its own last-used multiplier independently, so scaling one recipe never affects another that happens to be open at the same time — and persists across closing and reopening that recipe, but it is stored separately from the recipe's own data (not part of its JSON, and not included in that recipe's JSON export/import).

Scaling a quantity by the multiplier follows the format the quantity was originally entered in:

* A **decimal** quantity always displays its scaled result as a decimal (e.g. `0.5` cup ×0.25 = `0.125` cup), however many decimal places that takes.
* A **fraction** quantity displays its scaled result as a fraction when that result, expressed as an exact fraction and reduced to lowest terms, has a denominator in the set **{2, 3, 4, 8, 16, 32, 64}** — the standard kitchen fraction denominators. Otherwise it falls back to decimal. E.g. `1/2` cup ×0.25 = `1/8` cup (denominator 8, stays a fraction), but `1/2` cup ×0.24 = `0.12` cup (reduces to 3/25, denominator 25 is not in the set, falls back to decimal).

The multiplier itself is always a plain decimal number, never a fraction.

The "Export as PDF" action (see below) reflects whatever multiplier is currently active for that recipe, so the shared copy matches what the screen was showing.

## Storage

IndexedDB as source of truth, "Open" means pick from a stored list. Plus JSON import/export of individual recipes as well as backup/restore all saved data. RTW's model, which is already working in storage.js

The set of open recipes is itself persisted, and is restored when the app restarts. It has to be: a running instance recovered after the app was killed belongs to a recipe, and without that recipe being open there would be no tile to display the instance under.

A recipe with one or more running instances is force-open. Its close button still appears, but tapping it warns the user that closing will complete all running instances of that recipe's steps, and closes only on confirmation.

### Export as PDF

Separate from the JSON export above (which is a machine-readable backup/import format), the hamburger menu also offers "Export as PDF" — a human-readable copy of a recipe, so it can be shared with someone who doesn't have the app. It renders the recipe (name, description, servings, notes, ingredients, and every step's name, description, duration/temperature band, and alarms in plain language) as a standalone HTML document opened in a new window, then invokes the browser's own print dialog — the user picks "Save as PDF" there. No PDF-generation library is involved or needed. Same act-on-current-recipe-else-picker behaviour as the JSON Export button.

## UX

1. ### Home page

Icon row at the top: hamburger, open, new, search, connect

* Hamburger: settings, import, export, backup, restore, help, about  
* Open: open a recipe from app local storage  
* New: create a new (blank) recipe  
* Search: free text search through all names and description of all recipes in storage  
* Connect: because this is an Android-only PWA the user must initiate the BlueTooth connection to the thermometer 

Current temperature (if connected). This is the raw device reading, shown independent of any claim - it is what the thermometer is reporting, not the temperature "for" any particular step.  
A collection of tiles, vertically stacked, one for each open recipe. Each tile contains

* Recipe name  
* Recipe description (restricted to three lines, with ellipsis if required)  
* A close button (if the recipe has running instances, closing requires confirmation and completes those instances - see Storage)  
* A sub-tile for each step that is currently in progress (i.e. has been started, but not yet completed, may be paused). Note: if the step is running more than once (parallel instances of the same step) each instance gets its own sub-tile. Each sub-tile contains  
  * Step name  
  * If the step has a tag, the tag name  
  * Step description (restricted to two lines, with ellipsis if required)  
  * If the step has a duration, a progress bar. For an 'in temperature band' duration the bar also shows whether the time being accumulated is measured or assumed, and carries the estimate flag if it applies - see In-band accumulation.

Tapping a tile causes the recipe page to appear, showing the recipe

2. ## Recipe page

Icon row at the top: hamburger, home, edit, connect

* Edit: all of the recipe components become editable \- tap a component to edit it, you can also add and delete ingredients and steps

Current temperature (if connected). Raw device reading, as on the home page.  
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
   4. An indication of whether the step is currently in progress and how many instances

Tapping a tile causes the step page to appear, showing the step and the step controls

## C. Step page

If more than one instance of this step is currently in progress, swipe left/right to see other instances.

Icon row at the top: hamburger, home, back, edit, thermometer, connect

* Back: back to the recipe page  
* Edit: all of the step components become editable \- tap a component to edit it, you can also add and delete alarms  
* Thermometer: multiple steps can be in progress at one time, but the thermometer can only be in one place at a time, so this icon allows you to ‘claim’ the thermometer for this step. For example: you might be rising bread for a duration of 40 mins and a temperature band of 35-40 degrees, and coagulating tofu for a duration of 20 mins and a temperature band of 75-85 degrees, both simultaneously. If you claim the thermometer for the tofu then the bread has to rise without temperature monitoring or alarms (but it will still get the ‘duration reached’ time alarm and any other time alarms). Even if you are doing two simultaneous batches of tofu, you have to claim the thermometer for one of them.

##### Claim lifecycle

The claim only exists to decide which instance the temperature readings apply to, for in-band accumulation and for temperature alarms. If no instance is running, the notion of a claim is irrelevant and the app holds no claim.

* When an instance starts it automatically takes the claim, unless another instance already holds it. A new instance never takes the claim away from a holding instance.
* If the instance holding the claim ends (Complete), and other instances are still running, the thermometer becomes **unclaimed**. It is not handed on automatically. This state must be allowed, because otherwise the app would be assuming the user physically moves the probe from one place to another the instant a step completes, which is not true.
* An unclaimed thermometer stays unclaimed until the user taps the thermometer icon on some instance's step page to claim it.
* The thermometer icon is a **toggle**. Tapping it on the instance that currently holds the claim releases the claim, leaving the thermometer unclaimed. So if the user starts a step that is the only instance running, and does not want the thermometer associated with that step, they tap the icon once to drop the automatic claim.
* Tapping the icon on an instance that does not hold the claim gives the claim to that instance. If another instance held it, the claim transfers, because the user tapping the icon is the user telling the app they have physically moved the probe. The "never takes the claim" rule above governs automatic acquisition at Start only, not a deliberate tap.

The main page contains

Current temperature (if connected and the thermometer is claimed by this instance)

#### Step controls

Start, Pause/resume, Restart, Complete, Duplicate, Extend

* Start: set the step to ‘in progress’ and allow the step’s alarms to trigger. If the duration is ‘fixed length’ start the timer running, if the duration is ‘in temperature band’ start counting time in temperature, if outside the temperature band show a ‘waiting for temperature’ indicator. Whether the instance is counting on live data or on assumption is shown throughout - see In-band accumulation. Once the step is started a tag name can be entered.  
* Pause/resume: pause, then resume the timer. The step remains in progress while paused. Time alarms cannot trigger because the timer is not running, but temperature alarms can trigger because the step is in progress.  
* Restart: reset the timer to zero and start it running again. The step remains in progress. Any time alarms that have already triggered can now trigger again.  
* Complete:  set the step to ‘not in progress’, no more of the step’s alarms will trigger.  
* Duplicate: Start another instance of this step  
* Extend: add time to this instance’s duration without editing the recipe — see Extending a duration.

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

Every duration a user types anywhere in the app — a step's duration, a time alarm's trigger point into the step, a time alarm's repeat interval, and how much time to add on Extend — uses one standard control: three boxes for hours, minutes, and seconds, separated by colons, each showing `00` at zero. This replaced an earlier mixture of ad hoc minutes-only and seconds-only fields across different screens.

This does not apply to an alarm theme's ramp or repeat-interval-of-silence (Settings) — those are short audio parameters measured in a handful of seconds, not a step-timing duration, and stay plain seconds fields. An alarm theme's "Silence after" field is the exception: despite living in the same Settings card, it is a real duration (default 2 minutes, plausibly several) rather than an audio microparameter, so it does use the standard control.

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
  * Alarm theme

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

Temperature alarms need a deadband. At 12-bit the DS18B20 resolves 0.0625 °C and will jitter across a threshold repeatedly. The deadband is 2 deg C, and it applies as follows:

* A **heating** alarm at temperature T fires on an upward crossing of T, and re-arms only once the reading falls below T − 2. It cannot fire again until it has re-armed.
* A **cooling** alarm at temperature T is the mirror: it fires on a downward crossing of T, and re-arms only once the reading rises above T + 2.

The deadband applies to alarms only. It does NOT apply to the temperature band used for in-band accumulation - band entry and exit are evaluated on the raw reading against the band's low and high values, with no hysteresis. Jitter at 0.0625 °C resolution costs milliseconds of accumulated time either way, which does not matter.

When an alarm triggers it causes a notification, plays the sound, and triggers the system vibration. Because this is an Android PWA it is necessary for the app to register itself as a media player, and to continually play a near silent audio file. This not only allows the alarm audio files to play, but it also means the BLE data keeps flowing when the app is backgrounded. If the BLE data stops flowing an entirely separate (configured in the app settings from the hamburger icon) alarm must sound to alert the user that the temperature data is not flowing.

#### When an alarm is triggered

The user can silence the alarm by short-pressing the button on the thermometer, by tapping the ‘silence’ button in the app, or by interacting with the alarm's notification (see Notifications below - this is the only phone-side path available while the app is backgrounded). That silences the alarm, although it may re-trigger while the step is in progress, e.g. if the temperature goes up past a heating temperature alarm that triggers the alarm. The user silences it, but then the temperature drops below that alarm temperature, the next time it goes up past the temperature it will trigger again.

A button press can only silence one alarm. If multiple alarms are firing the button press silences the earliest one to fire. Three simultaneous alarms requires three presses. 

For a repeating alarm, silencing kills the one occurrence that is sounding, it does not cancel the repeats.

#### Missed status

An alarm left sounding for its theme's "Silence after" duration with nobody acknowledging it goes to **missed** status: audio and vibration stop, but the alarm stays outstanding rather than quietly going back to idle. This applies uniformly to all three alarm kinds (time, temperature, and the implicit data-loss alarm), and the countdown to missed runs on real wall-clock time regardless of whether the step is paused.

A missed alarm is cleared one of two ways:

* **It is dismissed.** A distinct action from silencing, since a missed alarm has nothing currently sounding to silence.
* **It retriggers on its own.** A repeating time alarm's next interval, a temperature alarm's next crossing after re-arming by deadband, and the data-loss alarm's next loss episode after reconnecting, all fire and sound again even if the previous occurrence was left missed and never dismissed — and that retrigger implicitly clears the earlier missed status (there is only one slot of runtime state per alarm, no history of separate occurrences, so the fresh occurrence simply replaces the stale one). This is deliberate: the point of a repeating alarm is that a missed occurrence must never hold up the next one — a 5-minute repeat with a short silence-after must keep repeating every 5 minutes even if the user never reaches the phone in time to dismiss any given occurrence, or the whole feature would be self-defeating.

A **one-shot** time alarm and the **duration-reached** alarm are the exception: neither ever fires again on its own once it has fired (one-shot by definition; duration-reached unless re-armed via Extend or Restart), so dismissing is the only way to clear their missed status.

Restart clears missed status for every alarm on the step, including temperature alarms (which Restart otherwise leaves alone) — a restart is a fresh run of the step, and a stale missed flag would otherwise permanently block that one alarm with no other way to clear it.

Currently, a missed alarm is resolved from the step page itself (a "Missed" list next to "Sounding", with a Dismiss button per alarm) rather than from a dedicated overlay or the notification — that's a planned later addition. A missed alarm's notification is not yet distinguished from a sounding one beyond going quiet (no more re-posts/vibration nags); its Silence action still shows, and tapping it while already missed is a harmless no-op.

Press-count arithmetic: if presses are received when no alarm is sounding, they are swallowed. If one alarm sounds, and the user presses twice, the alarm is silenced and the second press is swallowed. When the counter wraps or a cold restart of the Feather we will see the count go down instead of up. Treat the count going down as a single button press.

The press count is a uint8 in the MEASUREMENT packet, so what the app acts on is the difference between consecutive packets, not the absolute value. That difference is only meaningful within a continuous stream of packets:

* On first connect the app has no previous count. **Seed** the baseline from the first packet and act on nothing. Do not treat the first packet's value as N presses.
* On any reconnect, **seed** again from the first packet after the gap. Do not apply the difference across the gap. The difference might be +4, but there is no way to know how those four presses interleaved with alarms firing, silencing and re-arming while the app was blind, so applying it would silence four alarms for reasons the user cannot see.
* Only apply differences between packets that arrived back to back within one unbroken connection.

Presses made while disconnected are therefore lost. That is correct: the thermometer has no idea what is sounding on the phone, and a press the app did not witness in context cannot be attributed to an alarm.

#### Restart

Restart re-arms all time alarms, including the duration-reached alarm. Temperature alarms are not affected because they re-arm themselves by temperature, not time — except that Restart does clear a temperature alarm's missed status, same as every other alarm (see "Missed status" above).

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

##### Silencing from the notification

The notification is the only phone-side silence path available while the app is hidden, so it must accept the interaction:

* The notification carries a **Silence** action.
* The service worker's `notificationclick` handler silences the alarm. If a client is alive it posts the silence to the client; if no client is alive the service worker records the silence so the client applies it on wake, and closes the notification either way.
* Silencing from the notification is identical in effect to a thermometer button press or an in-app silence: it silences exactly the one alarm the notification belongs to, and does not cancel a repeating alarm's future repeats.
* A notification for a silenced alarm is closed immediately and not re-posted.

If several alarms are sounding, each has its own notification and its own tag, so each can be silenced independently. This is the one place where the phone-side path is better than the thermometer button, which always silences the earliest alarm to fire.

## In-band accumulation

If the BLE connection is lost, or the thermometer is claimed by another instance after starting to accumulate in-band time, then the timer continues with the last value it had. That is, it continues to count in-band if the last data point was in-band, and vice versa. If an instance never has any temperature data (no BLE, other instance has thermometer throughout) then it accumulates in-band time from the start (assume in-band if no data available, assume last data remains valid if data flow stops)

The "assume in-band if no data available" default only applies to an instance that holds no claim at all (or never gets one) — it does not apply to a claimed instance before its very first real measurement. A claimed instance is actively expecting a reading any moment (the connection already exists), and on real hardware the first packet after claiming can take a few seconds to arrive; assuming in-band for that gap silently hands out real elapsed time — and permanently marks the run as "≈ estimated" — for a step that was never actually without a thermometer. A claimed instance therefore counts nothing at all (shows "waiting for temperature") until its first real measurement, then behaves exactly as measured data dictates from then on. Once a claimed instance has been measured at least once, every later gap is an ordinary continuation per the paragraph above, regardless of claim.

#### Measured vs assumed time

The rules above mean an instance can accumulate in-band time on assumption rather than on measurement, and the user must be able to see which. Otherwise an 'in temperature band' step whose probe is elsewhere behaves indistinguishably from a 'fixed length' step, and an instance that was out of band when the data stopped sits frozen forever with nothing on screen to say so.

At any moment an instance with an 'in temperature band' duration is in one of two provenance states:

* **Measured** – this instance holds the claim, packets are arriving within the 5 second timeout, and the reading is valid (probe present, not the 0x8000 sentinel). In-band or out-of-band is being decided by live data.
* **Assumed** – anything else: the thermometer is unclaimed, another instance holds it, the connection is down, or the reading is unusable. In-band or out-of-band is being carried forward per the rules above.

This gives four progress bar states, and they must be visually distinct:

1. Measured, in band – solid fill, advancing.
2. Measured, out of band – solid fill, not advancing, with the 'waiting for temperature' indicator.
3. Assumed, counting – hatched fill, advancing. The bar is moving on an assumption, not a measurement.
4. Assumed, not counting – hatched fill, not advancing, with a 'waiting for temperature – no data' indicator. This is the silent-stall case and it must not look like a step that is simply waiting on a live reading.

An instance with a 'fixed length' duration is always measured and always renders solid. Time is never in doubt.

##### The estimate flag latches

Once an instance has accumulated any in-band time while assumed, it is flagged as estimated for the rest of its life, even if it later regains the probe. Its accumulated total is partly assumption from then on and cannot be un-assumed. Show the flag next to the elapsed figure on the step page and on the home sub-tile - an '≈' marker is enough, with the reason available on the step page.

#### Pause

Pause: temperature alarms still fire, time alarms don't. In-band accumulation pauses.

#### Restart

Restart sets the accumulation to zero.

#### Time alarms and the duration-reached alarm run on the same clock as the progress bar

A step's time alarms and its duration-reached alarm never advance against a clock other than the
one its own progress bar shows, so a step can never report "duration reached" while its own
progress bar disagrees:

* No duration, or a **'fixed length'** duration: running time only (excludes pauses), regardless
  of whether the step also has a temperature band. This is what "time is never in doubt" for a
  fixed-length duration means in practice — a temperature band on a fixed-length step drives its
  temperature alarms and band-boundary alarms, but has no say over its timing.
* An **'in temperature band'** duration: the same in-band accumulation the progress bar shows.
  Time spent out of band does not count towards a time alarm's trigger point or towards the
  duration-reached alarm, no matter how much wall-clock time has passed.

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

See the file FeatherThermometer.ino for details.  
Use GATT. Subscribe to the 8-byte custom MEASUREMENT characteristic (`b7e1c0a0-4f3d-4a21-9f3e-6c1a2d5b7e02`). The custom 128-bit UUID must be listed in `optionalServices` on `requestDevice`. Manage the device back button as in RTW (backGuard.js) to get user to confirm before exit.

#### Connecting

Connect always requires a user gesture, but it does not always require the device picker. Follow the three-tier path in ble-hr-tool.zip (Manawa Pace), in the `connectBtn` click handler:

1. **Already connected.** If a device reference is held and `gatt.connected` is true, just restore the UI. Do not reconnect.
2. **Previously paired.** Call `navigator.bluetooth.getDevices()`. If it returns a device, use the gesture to drive `gatt.connect()` on it directly, retrying up to 3 times at 3 second intervals, since the Feather may take a few seconds to start advertising again after a disconnect. This is the path that matters after Chrome has discarded the tab mid-ferment: the user taps Connect once and is back on the same thermometer with no device list.
3. **Picker.** Only if the above finds nothing or fails, call `requestDevice()`. Clear any stale non-connected device reference first, because some browsers block the picker while an abandoned reference is still held.

So a page reload loses the JS device reference but not the browser's permission for the device, and Connect after a reload should not show the user a picker.

#### Disconnect and reconnect

Listen for `gattserverdisconnected`. On an unexpected disconnect while any instance is running, retry `gatt.connect()` on a backoff, as Manawa Pace does; a long press on the thermometer's button is a legitimate power-off, so give up after a bounded number of attempts and null the device reference so the next Connect starts clean. Every (re)connect re-seeds the press-count baseline (see How alarms work).

#### BLE-data-loss alarm

The timeout is 5 seconds without a MEASUREMENT packet.

The alarm fires only when the missing data would actually change something, i.e. when all of the following hold:

* an instance is running, and
* that instance holds the claim, and
* that instance has a temperature band or at least one temperature alarm.

If the thermometer is unclaimed, or the claiming instance has neither a temperature band nor any temperature alarms, no BLE-data-loss alarm is fired. An unclaimed thermometer is a normal state (see Claim lifecycle), not a fault, so it must not nag.

When the probe is absent (flags bit0) or temperature reads the 0x8000 sentinel, show ‘no data’ where the temperature would be displayed. Note this is distinct from data loss: packets are still arriving, so the 5 second timeout does not run, but there is no usable reading. In-band accumulation treats it exactly as it treats a lost connection - carry on with the last known in-band or out-of-band state.

## History

No history for this MVP.

## Programming style

Refer to ride-the-wind.zip. Follow the example of how to organise the repo, the use of tests, and the platform/libraries used. Obviously the UX is very different, but stylistically the Ride the Wind project should act as a guide.