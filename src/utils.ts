/**
 * make a throttled function that actually executes with the last given arguments.
 */
export function throttle<T extends (...args: any) => void>(fn: T, wait: number) {
  let timerId: any;
  let lastArgs: any[] | undefined;

  function cancel(invoke = false) {
    if (!timerId) return;

    if (invoke && lastArgs) fn(...lastArgs);
    clearTimeout(timerId);

    timerId = null;
    lastArgs = undefined;
  }

  const throttled = function throttled(...args: any[]) {
    lastArgs = args;

    if (!timerId) {
      timerId = setTimeout(() => cancel(true), wait);
    }
  } as unknown as T & { cancel(): void; flush(): void };

  throttled.cancel = () => cancel(false);
  throttled.flush = () => cancel(true);

  return throttled;
}

/**
 * extract and remove items from the array safely.
 *
 * this will mutate `arr` the input array.
 *
 * @returns removed items in `indexes` order
 */
export function removeItems<T>(arr: T[], indexes: number[]): T[] {
  const ans = indexes.map(i => arr[i]!).filter(x => x !== undefined);
  [...indexes].sort((a, b) => b - a).forEach(i => arr.splice(i, 1));
  return ans;
}

/**
 * move items inside an array safely.
 *
 * this will mutate `arr` the input array.
 */
export function moveItemsInArray(arr: any[], fromIndexes: number[], toIndex: number) {
  const items = removeItems(arr, fromIndexes);
  arr.splice(toIndex, 0, ...items);
}

/**
 * move items between two arrays safely.
 *
 * this will mutate `fromArr` and `toArr`
 *
 * @param fromArr
 * @param fromIndexes
 * @param toArr
 * @param toIndex
 */
export function moveItemsBetweenArrays(fromArr: any[], fromIndexes: number[], toArr: any[], toIndex: number) {
  const items = removeItems(fromArr, fromIndexes);
  toArr.splice(toIndex, 0, ...items);
}
