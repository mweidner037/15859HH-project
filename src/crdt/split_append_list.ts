import { LastWalked } from "./text_logn";

class Node<V> {
  bParent: Node<V> | null = null;
  bLeftChild: Node<V> | null = null;
  bRightChild: Node<V> | null = null;
  bHeight: number = 0; // Height of the tree rooted at this node, i.e.,
  // the longest path length from this node to a leaf.

  constructor(readonly value: V) {}

  get bIsLeftChild(): boolean {
    return this.bParent !== null && this.bParent.bLeftChild === this;
  }

  /**
   * AVL tree balance factor.
   */
  get bF(): number {
    return height(this.bRightChild) - height(this.bLeftChild);
  }

  toString() {
    return this.value + "";
  }
}

function height<V>(node: Node<V> | null): number {
  return node === null ? -1 : node.bHeight;
}

/**
 * A manager for lists that can be split or appended to,
 * and for which you can query the end of a given value's list, all
 * in time O(log(n)).
 *
 * Implemented using AVL trees and their split operation.
 */
export class SplitAppendListManager<V> {
  private _nodeByValue = new Map<V, Node<V>>();

  private nodeByValue(value: V): Node<V> {
    const node = this._nodeByValue.get(value);
    if (node === undefined) {
      throw new Error("Unknown value: " + value);
    }
    return node;
  }

  /**
   * For debugging. Returns the tree's root value's toString().
   */
  getTreeID(value: V): string {
    let current = this.nodeByValue(value);
    // Go up to the root.
    while (current.bParent !== null) current = current.bParent;
    return current.value + "";
  }

  /**
   * Creates a new list containing just `value.`
   */
  create(value: V): void {
    this.createInternal(value);
  }

  private createInternal(value: V): Node<V> {
    const node = new Node(value);
    this._nodeByValue.set(value, node);
    return node;
  }

  /**
   * Appends a new value `value` to the end of the list containing
   * `listEntry`.
   */
  append(listEntry: V, value: V): void {
    const node = this.createInternal(value);
    const parent = this.getEndNode(listEntry);
    parent.bRightChild = node;
    node.bParent = parent;

    // Update heights.
    let heightFromNode = 1;
    let current: Node<V> | null = parent;
    while (current !== null) {
      current.bHeight = Math.max(current.bHeight, heightFromNode);
      heightFromNode++;
      current = current.bParent;
    }

    // Rebalance the tree.
    this.rebalance(node);
  }

  /**
   * AVL tree rebalance starting at the given newly inserted node.
   * This also updates balanced factors to account for the new node.
   */
  private rebalance(node: Node<V>): void {
    // Using wikipedia alg: https://en.wikipedia.org/wiki/AVL_tree#Insert
    let Z = node;
    let G: Node<V> | null = null;
    for (let X = Z.bParent; X !== null; X = Z.bParent) {
      let N: Node<V>;
      if (Z === X.bRightChild) {
        if (X.bF > 0) {
          G = X.bParent;
          if (Z.bF < 0) N = this.rotate_RightLeft(X, Z);
          else N = this.rotate_Left(X);
        } else {
          if (X.bF < 0) {
            // X.bF = 0;
            break;
          }
          // X.bF = 1;
          Z = X;
          continue;
        }
      } else {
        if (X.bF < 0) {
          G = X.bParent;
          if (Z.bF > 0) N = this.rotate_LeftRight(X, Z);
          else N = this.rotate_Right(X);
        } else {
          if (X.bF > 0) {
            // X.bF = 0;
            break;
          }
          // X.bF = -1;
          Z = X;
          continue;
        }
      }

      N.bParent = G;
      if (G !== null) {
        if (X === G.bLeftChild) G.bLeftChild = N;
        else G.bRightChild = N;
        // G.bCount has not changed: its children have moved around, but the
        // values in their subtrees are unchanged.
      } // else this.bRootNode = N; // We don't actually track the root.
      break;
    }
  }

  private rotate_Left(X: Node<V>): Node<V> {
    const Z = X.bRightChild!;
    const t23 = Z.bLeftChild;
    X.bRightChild = t23;
    if (t23 !== null) t23.bParent = X;
    Z.bLeftChild = X;
    X.bParent = Z;
    // if (Z.bF === 0) {
    //   X.bF = 1;
    //   Z.bF = -1;
    // } else {
    //   X.bF = 0;
    //   Z.bF = 0;
    // }

    // Update bCount's of all nodes whose children changed, in bottom-up
    // order so that they are accurate.
    this.updateBHeight(X);
    this.updateBHeight(Z);

    return Z;
  }

  private rotate_Right(X: Node<V>): Node<V> {
    const Z = X.bLeftChild!;
    const t23 = Z.bRightChild;
    X.bLeftChild = t23;
    if (t23 !== null) t23.bParent = X;
    Z.bRightChild = X;
    X.bParent = Z;
    // if (Z.bF === 0) {
    //   X.bF = 1;
    //   Z.bF = -1;
    // } else {
    //   X.bF = 0;
    //   Z.bF = 0;
    // }

    this.updateBHeight(X);
    this.updateBHeight(Z);

    return Z;
  }

  private rotate_RightLeft(X: Node<V>, Z: Node<V>): Node<V> {
    const Y = Z.bLeftChild!;
    const t3 = Y.bRightChild;
    Z.bLeftChild = t3;
    if (t3 !== null) t3.bParent = Z;
    Y.bRightChild = Z;
    Z.bParent = Y;
    const t2 = Y.bLeftChild;
    X.bRightChild = t2;
    if (t2 !== null) t2.bParent = X;
    Y.bLeftChild = X;
    X.bParent = Y;
    // if (Y.bF === 0) {
    //   X.bF = 0;
    //   Z.bF = 0;
    // } else {
    //   if (Y.bF > 0) {
    //     X.bF = -1;
    //     Z.bF = 0;
    //   } else {
    //     X.bF = 0;
    //     Z.bF = 1;
    //   }
    // }
    // Y.bF = 0;

    this.updateBHeight(X);
    this.updateBHeight(Z);
    this.updateBHeight(Y);

    return Y;
  }

  private rotate_LeftRight(X: Node<V>, Z: Node<V>): Node<V> {
    const Y = Z.bRightChild!;
    const t3 = Y.bLeftChild;
    Z.bRightChild = t3;
    if (t3 !== null) t3.bParent = Z;
    Y.bLeftChild = Z;
    Z.bParent = Y;
    const t2 = Y.bRightChild;
    X.bLeftChild = t2;
    if (t2 !== null) t2.bParent = X;
    Y.bRightChild = X;
    X.bParent = Y;
    // if (Y.bF === 0) {
    //   X.bF = 0;
    //   Z.bF = 0;
    // } else {
    //   if (Y.bF > 0) {
    //     X.bF = -1;
    //     Z.bF = 0;
    //   } else {
    //     X.bF = 0;
    //     Z.bF = 1;
    //   }
    // }
    // Y.bF = 0;

    this.updateBHeight(X);
    this.updateBHeight(Z);
    this.updateBHeight(Y);

    return Y;
  }

  /**
   * Set node.bHeight assuming its bChildren's bHeights are accurate.
   */
  private updateBHeight(node: Node<V>): void {
    if (node.bLeftChild === null && node.bRightChild === null) node.bHeight = 0;
    else {
      node.bHeight =
        1 +
        Math.max(node.bLeftChild?.bHeight ?? 0, node.bRightChild?.bHeight ?? 0);
    }
  }

  /**
   * Returns the value at the end of the list containing `value`.
   */
  getEnd(value: V): V {
    return this.getEndNode(value).value;
  }

  private getEndNode(value: V): Node<V> {
    let current = this.nodeByValue(value);
    // Go up to the root.
    while (current.bParent !== null) current = current.bParent;
    // Go down to the rightmost descendant.
    while (current.bRightChild !== null) current = current.bRightChild;
    return current;
  }

  /**
   * Splits the list containing `value` into ranges `[start, value]` and
   * `(value, end]`.
   */
  split(value: V): void {
    // console.log("SPLIT");
    const node = this.nodeByValue(value);
    // console.log(node + "");
    // this.printTreeWalk(node);

    // Make path from node to its root.
    const path: Node<V>[] = [];
    let root: Node<V>;
    for (let current = node; ; ) {
      if (current.bParent === null) {
        root = current;
        break;
      }
      path.push(current);
      current = current.bParent;
    }
    // console.log(path);
    // console.log(root + "");

    // Split.
    const [left, right] = this.splitInternal(root, path);
    // if (left !== null) {
    //   console.log("left:");
    //   this.printTreeWalk(left);
    // }
    // if (right !== null) {
    //   console.log("right:");
    //   this.printTreeWalk(right);
    // }

    // Since both left and right exclude value, we must append it to left.
    // Note this overrides the current node with value.
    if (left !== null) {
      this.append(left.value, value);
    } else this.create(value);
  }

  /**
   * AVL split from Wikipedia. Note left and right both exclude the found node.
   * While splitting, new nodes may be created; their values are reassigned
   * in this.nodesByValue.
   * @param  T    The root of the subtree to split.
   * @param  path The path [border node, T).
   * @return      Roots of left and right subtrees, possibly new nodes.
   */
  private splitInternal(
    T: Node<V>,
    path: Node<V>[]
  ): [left: Node<V> | null, right: Node<V> | null] {
    // Pseudocode: https://en.wikipedia.org/wiki/AVL_tree#Set_operations_and_bulk_operations
    const [L, m, R] = this.expose(T);
    // Instead of using key comparisons, we determine which way to go
    // using path, which encodes the results of those comparisons.
    if (path.length === 0) {
      // "k = T.m"
      // Erase the old parents.
      if (L !== null && L.bParent !== null) {
        if (L.bIsLeftChild) L.bParent.bLeftChild = null;
        L.bParent = null;
      }
      if (R !== null && R.bParent !== null) {
        if (R.bIsLeftChild) R.bParent.bLeftChild = null;
        R.bParent = null;
      }
      return [L, R];
    }
    const nextNode = path.pop()!;
    if (nextNode === L) {
      // "k < T.m"
      const [Lprime, Rprime] = this.splitInternal(L, path);
      return [Lprime, this.join(Rprime, m, R)];
    }
    if (nextNode === R) {
      // "k > T.m"
      const [Lprime, Rprime] = this.splitInternal(R, path);
      return [this.join(L, m, Lprime), Rprime];
    } else {
      throw new Error("Bad path: nextNode is not L or R");
    }
  }

  private join(TL: Node<V> | null, k: V, TR: Node<V> | null): Node<V> {
    if (height(TL) > height(TR) + 1) return this.joinRightAVL(TL!, k, TR);
    if (height(TR) > height(TL) + 1) return this.joinLeftAVL(TL, k, TR!);
    return this.nodeWithChildren(TL, k, TR);
  }

  private joinRightAVL(TL: Node<V>, k: V, TR: Node<V> | null): Node<V> {
    const [l, kprime, c] = this.expose(TL);
    if (height(c) <= height(TR) + 1) {
      const Tprime = this.nodeWithChildren(c, k, TR);
      if (height(Tprime) <= height(l) + 1) {
        return this.nodeWithChildren(l, kprime, Tprime);
      } else {
        return this.rotate_Left(
          this.nodeWithChildren(l, kprime, this.rotate_Right(Tprime!))
        );
      }
    } else {
      const Tprime = this.joinRightAVL(c!, k, TR);
      const Tprimeprime = this.nodeWithChildren(l, kprime, Tprime);
      if (height(Tprime) <= height(l) + 1) return Tprimeprime;
      else return this.rotate_Left(Tprimeprime);
    }
  }

  private joinLeftAVL(TL: Node<V> | null, k: V, TR: Node<V>): Node<V> {
    const [c, kprime, r] = this.expose(TR);
    if (height(c) <= height(TL) + 1) {
      const Tprime = this.nodeWithChildren(TL, k, c);
      if (height(Tprime) <= height(r) + 1) {
        return this.nodeWithChildren(Tprime, kprime, r);
      } else {
        return this.rotate_Right(
          this.nodeWithChildren(this.rotate_Left(Tprime!), kprime, r)
        );
      }
    } else {
      const Tprime = this.joinLeftAVL(TL, k, c!);
      const Tprimeprime = this.nodeWithChildren(Tprime, kprime, r);
      if (height(Tprime) <= height(r) + 1) return Tprimeprime;
      else return this.rotate_Right(Tprimeprime);
    }
  }

  private expose(node: Node<V>): [l: Node<V> | null, k: V, r: Node<V> | null] {
    return [node.bLeftChild, node.value, node.bRightChild];
  }

  /**
   * Implement Wikipedia's "Node(l, k, r)". Note k may already be claimed
   * by a different node; this overwrites it.
   */
  private nodeWithChildren(
    l: Node<V> | null,
    k: V,
    r: Node<V> | null
  ): Node<V> {
    const node = this.createInternal(k);
    node.bLeftChild = l;
    if (l !== null) l.bParent = node;
    node.bRightChild = r;
    if (r !== null) r.bParent = node;
    this.updateBHeight(node);
    return node;
  }

  // Debugging

  printTreeWalk(nodeIn: Node<V>): void {
    console.log("SALM.printTreeWalk(" + nodeIn.value + "):");

    let current = nodeIn;
    while (current.bParent !== null) current = current.bParent;
    const root = current;

    // Walk the tree.
    let node: Node<V> | null = root;
    let lastWalked: LastWalked = LastWalked.PARENT;
    let depth = 0;
    while (node !== null) {
      switch (lastWalked) {
        case LastWalked.PARENT:
          // We are just starting to walk the subtree at node.
          if (node.bLeftChild !== null) {
            // Walk it next.
            node = node.bLeftChild;
            // lastWalked = LastWalked.PARENT;
            depth++;
          } else {
            // Skip over the left subtree.
            // node = node;
            lastWalked = LastWalked.LEFT_CHILD;
            // depth = depth;
          }
          break;
        case LastWalked.LEFT_CHILD:
          // We just finished walking the left child. Now visit this node
          // followed by its right subtree.
          const tabs = new Array<string>(depth).fill("  ").join("");
          console.log(tabs + node);
          if (node.bRightChild !== null) {
            // Walk it next.
            node = node.bRightChild;
            lastWalked = LastWalked.PARENT;
            depth++;
          } else {
            // Skip over the right subtree.
            // node = node;
            lastWalked = LastWalked.RIGHT_CHILD;
            // depth = depth;
          }
          break;
        case LastWalked.RIGHT_CHILD:
          // We just finished walking the right child, hence node's whole sbutree.
          // Go back up.
          lastWalked = node.bIsLeftChild
            ? LastWalked.LEFT_CHILD
            : LastWalked.RIGHT_CHILD;
          node = node.bParent;
          depth--;
          break;
      }
    }
  }
}
