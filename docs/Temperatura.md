# Temperatura

The app that manages recipe steps by time and temperature

# Specification

This app allows you to create, edit, and save recipes. It also allows you to start any step of a recipe and it will monitor time and temperature for that step, giving alarms according to the settings in the recipe. An important feature is the ability to start more than one step at a time, from different recipes, the same recipe, even the same step from the same recipe (e.g. starting one loaf of bread to rise, then later starting a second loaf rising \- same recipe, same step, two instances running in parallel with different start/finish times).

## Style

A sans-serif font. Colour theme to be cool blues, based off the supplied icon background. The icon background is a gradient from about `#B1DCED` down to `#5CAADB`, dial face `#F7F4ED`, accent red `#C20104`. That's a *light* palette. Just the one palette for this MVP.

## Temperature monitoring

Temperature data comes from the FeatherThermometer via BLE connection. The BLE connection supplies temperature, battery level, and button press data. The button press data is used to cancel/silence alarms. 

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

## Storage

IndexedDB as source of truth, "Open" means pick from a stored list. Plus JSON import/export of individual recipes as well as backup/restore all saved data. RTW's model, which is already working in storage.js

The set of open recipes is itself persisted, and is restored when the app restarts. It has to be: a running instance recovered after the app was killed belongs to a recipe, and without that recipe being open there would be no tile to display the instance under.

A recipe with one or more running instances is force-open. Its close button still appears, but tapping it warns the user that closing will complete all running instances of that recipe's steps, and closes only on confirmation.

## UX

1. ### Home page

Icon row at the top: hamburger, open, new, search, connect

* Hamburger: import, export, backup, restore, settings, help, about  
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
5. A panel for the ingredients  
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

Start, Pause/resume, Restart, Complete, Duplicate

* Start: set the step to ‘in progress’ and allow the step’s alarms to trigger. If the duration is ‘fixed length’ start the timer running, if the duration is ‘in temperature band’ start counting time in temperature, if outside the temperature band show a ‘waiting for temperature’ indicator. Whether the instance is counting on live data or on assumption is shown throughout - see In-band accumulation. Once the step is started a tag name can be entered.  
* Pause/resume: pause, then resume the timer. The step remains in progress while paused. Time alarms cannot trigger because the timer is not running, but temperature alarms can trigger because the step is in progress.  
* Restart: reset the timer to zero and start it running again. The step remains in progress. Any time alarms that have already triggered can now trigger again.  
* Complete:  set the step to ‘not in progress’, no more of the step’s alarms will trigger.  
* Duplicate: Start another instance of this step

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
* Vibrate \- whether or not to vibrate for this alarm. A boolean, not a pattern: the vibration pattern itself is fixed in code (see How alarms work).

User can create, edit, and delete alarm themes.

There is also an alarm theme for lost BLE connection.

#### Sound files

* Only MP3 is accepted, 5 seconds maximum length. Longer files are rejected at pick time with a message saying why.
* The picked file is decoded once and stored in IndexedDB as an ArrayBuffer, alongside the theme. It is NOT stored as a `FileSystemFileHandle`: an alarm must be playable while the app is hidden, with no user gesture and no permission prompt available, so the audio has to be owned by the app rather than referenced on the device's filesystem.
* Playback goes through `decodeAudioData` on the keep-alive `AudioContext`, not an `<audio>` element. That context is already resumed and already holding a media session, so it is the one audio path proven to survive backgrounding on this platform.
* The ramp is a `linearRampToValueAtTime` on a gain node, from silence to 1.0 (which is device media volume) over the theme's ramp seconds.
* The decoded buffer loops until the alarm is silenced. If ramp is non-zero the ramp runs once, on the first pass, not on every loop.
* If decoding fails at any point, including at play time, fall back to the built-in synthesised tone (below) and log it. An alarm must never fail silently.

#### Bundled defaults

A fresh install has no user-supplied sound files, so the app ships with one built-in theme whose sound is synthesised in code (oscillator based, as in Manawa Pace) rather than a bundled MP3. It is:

* the default theme for every new alarm,
* the default theme for the lost-BLE-connection alarm,
* the fallback when a user theme's audio fails to decode.

It cannot be deleted. Its ramp and vibrate settings can be edited.

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

An unsilenced alarm sounds forever.

Press-count arithmetic: if presses are received when no alarm is sounding, they are swallowed. If one alarm sounds, and the user presses twice, the alarm is silenced and the second press is swallowed. When the counter wraps or a cold restart of the Feather we will see the count go down instead of up. Treat the count going down as a single button press.

The press count is a uint8 in the MEASUREMENT packet, so what the app acts on is the difference between consecutive packets, not the absolute value. That difference is only meaningful within a continuous stream of packets:

* On first connect the app has no previous count. **Seed** the baseline from the first packet and act on nothing. Do not treat the first packet's value as N presses.
* On any reconnect, **seed** again from the first packet after the gap. Do not apply the difference across the gap. The difference might be +4, but there is no way to know how those four presses interleaved with alarms firing, silencing and re-arming while the app was blind, so applying it would silence four alarms for reasons the user cannot see.
* Only apply differences between packets that arrived back to back within one unbroken connection.

Presses made while disconnected are therefore lost. That is correct: the thermometer has no idea what is sounding on the phone, and a press the app did not witness in context cannot be attributed to an alarm.

#### Restart

Restart re-arms all time alarms, including the duration-reached alarm. Temperature alarms are not affected because they re-arm themselves by temperature, not time.

#### Notifications and vibration

On Android, `navigator.vibrate()` is ignored when the document is hidden, and an in-progress vibration is cancelled by the visibility change. Vibration while backgrounded is therefore only reachable through the `vibrate` option on a service-worker notification. See ble-hr-tool.zip (Manawa Pace) for a working example of a system vibration firing while the app is backgrounded: `triggerNotification()` in app.js routes to the service worker, and the `message` handler in sw.js calls `showNotification` with the pattern.

Alert routing follows that example:

* **App visible:** vibrate directly with `navigator.vibrate(pattern)`. No notification is needed, because the app itself is on screen with a silence button.
* **App hidden:** post to the service worker, which shows a notification carrying the vibration pattern. The audio plays through the keep-alive `AudioContext` either way.

The vibration pattern is fixed in code, one pattern for all alarms. The per-theme Vibrate setting only decides whether it is used.

##### Notification lifetime

An unsilenced alarm sounds forever, but a notification only vibrates at the moment it is posted. So while an alarm is sounding and the app is hidden, its notification is **re-posted every 5 seconds**. Each re-post fires the vibration again, which is what makes a phone in a pocket keep nagging.

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