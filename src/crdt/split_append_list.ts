/**
 * A manager for lists that can be split or appended to,
 * and for which you can query the end of a given value's list, all
 * in time O(log(n)).
 *
 * Implemented using AVL trees and their split operation.
 */
export class SplitAppendListManager<T> {
  // TODO: replace with smart impl.
  private listByValue = new Map<T, T[]>();

  /**
   * Creates a new list containing just `value.`
   */
  create(value: T): void {
    this.listByValue.set(value, [value]);
  }

  /**
   * Appends a new value `value` to the end of the list containing
   * `listEntry`.
   */
  append(listEntry: T, value: T): void {
    const list = this.listByValue.get(listEntry)!;
    list.push(value);
    this.listByValue.set(value, list);
  }

  /**
   * Returns the value at the end of the list containing `value`.
   */
  getEnd(value: T): T {
    const list = this.listByValue.get(value)!;
    return list[list.length - 1];
  }

  /**
   * Splits the list containing `value` into ranges `[start, value]` and
   * `(value, end]`.
   */
  split(value: T): void {
    const list = this.listByValue.get(value)!;
    const valueIndex = list.indexOf(value);
    const before = list.slice(0, valueIndex + 1);
    const after = list.slice(valueIndex + 1);
    for (const v of before) this.listByValue.set(v, before);
    for (const v of after) this.listByValue.set(v, after);
  }
}
