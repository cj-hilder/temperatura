import { fthermDriver } from "./ftherm.js";
import { bbqDriver } from "./bbq.js";

// Order matters only for identifying a freshly-picked device (see manager.js
// identifyDriver): the first driver whose service the device exposes wins.
export const DRIVERS = [fthermDriver, bbqDriver];

export const driverForKind = (kind, drivers = DRIVERS) => drivers.find((d) => d.kind === kind) ?? null;

// requestDevice takes the OR of its filter entries, so the picker can offer
// every kind of probe at once; every driver's service still has to be listed
// in optionalServices or GATT access to it is refused after the pick.
export function pickerOptions(drivers = DRIVERS) {
  return {
    filters: drivers.flatMap((d) => d.filters),
    optionalServices: drivers.map((d) => d.serviceUuid),
  };
}
