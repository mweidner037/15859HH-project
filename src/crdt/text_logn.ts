import * as collabs from "@collabs/collabs";
import { SplitAppendListManager } from "./split_append_list";

// Reimplementation of CText that use the O(log(n) + c) time
// insertion algorithm. For simplicity, it leaves out practical opts
// and modularity.

interface DeleteMessage {
  type: "delete";
  id: string;
}

interface InsertMessage {
  type: "insert";
  id: string;
  parentID: string;
  isLeftChild: boolean;
  value: string;
}

type NetworkMessage = DeleteMessage | InsertMessage;

class Node {
  readonly leftChildren: Node[] = [];
  readonly rightChildren: Node[] = [];

  constructor(
    readonly id: string,
    readonly parent: Node | null,
    readonly isLeftChild: boolean,
    readonly value: string, // a single char, except for the root.
    public isPresent: boolean
  ) {}

  children(left: boolean): Node[] {
    return left ? this.leftChildren : this.rightChildren;
  }

  // Properties for the balanced AVL tree ("b" for "balanced").
  // These are set when inserting the node into the balanced tree,
  // shortly after construction.
  bParent: Node | null = null;
  bLeftChild: Node | null = null;
  bRightChild: Node | null = null;
  bF: number = 0; // AVL tree balance factor
  /**
   * Number of present nodes in this node's balanced subtree, including itself.
   */
  bCount: number = 0;

  get bIsLeftChild(): boolean {
    return this.bParent !== null && this.bParent.bLeftChild === this;
  }

  toString() {
    return this.id;
  }
}

export enum LastWalked {
  PARENT,
  LEFT_CHILD,
  RIGHT_CHILD,
}

export class CTextLogn
  extends collabs.CPrimitive<collabs.CTextEventsRecord>
  implements collabs.PositionedList
{
  private readonly nodesByID = new Map<string, Node>();
  private readonly rootNode: Node;
  private bRootNode: Node;
  /** Points from each node to its leftmost descendant. */
  private leftSALM = new SplitAppendListManager<Node>();
  /** Points from each node to its rightmost descendant. */
  private rightSALM = new SplitAppendListManager<Node>();

  constructor(initToken: collabs.InitToken) {
    super(initToken);

    // Create root node.
    this.rootNode = new Node("", null, false, "", false);
    this.nodesByID.set(this.rootNode.id, this.rootNode);
    this.bRootNode = this.rootNode;
    this.leftSALM.create(this.rootNode);
    this.rightSALM.create(this.rootNode);
  }

  insert(index: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      this.insertOne(index + i, str.charAt(i));
    }
  }

  delete(startIndex: number, count = 1): void {
    for (let i = count - 1; i >= 0; i--) {
      this.deleteOne(startIndex + i);
    }
  }

  private insertOne(index: number, char: string) {
    let parent: Node;
    let isLeftChild: boolean;

    const leftOrigin =
      index === 0 ? this.rootNode : this.indexToNode(index - 1);
    if (leftOrigin.rightChildren.length !== 0) {
      // leftOrigin already has right children; become a left child of the
      // next (possibly deleted) node instead, which is guaranteed to have
      // no left children.
      parent = this.nextNode(leftOrigin);
      isLeftChild = true;
    } else {
      parent = leftOrigin;
      isLeftChild = false;
    }

    const message: InsertMessage = {
      type: "insert",
      id: this.runtime.getUID(),
      parentID: parent.id,
      isLeftChild,
      value: char,
    };
    this.sendPrimitive(JSON.stringify(message));
  }

  private deleteOne(index: number): void {
    const message: DeleteMessage = {
      type: "delete",
      id: this.indexToNode(index).id,
    };
    this.sendPrimitive(JSON.stringify(message));
  }

  protected receivePrimitive(
    message: collabs.Message,
    meta: collabs.MessageMeta
  ): void {
    const decoded = <NetworkMessage>JSON.parse(<string>message);
    switch (decoded.type) {
      case "insert": {
        const parent = this.nodesByID.get(decoded.parentID)!;
        const node = new Node(
          decoded.id,
          parent,
          decoded.isLeftChild,
          decoded.value,
          true
        );
        this.nodesByID.set(node.id, node);

        // Insert node among its same-side siblings, in order by id.
        const siblings = node.isLeftChild
          ? parent.leftChildren
          : parent.rightChildren;
        let i = 0; // Index-to-be.
        for (; i < siblings.length; i++) {
          if (node.id < siblings[i].id) break;
        }
        siblings.splice(i, 0, node);

        // Find the immediate predecessor or successor of node,
        // counting deleted nodes. Also update SALMs.
        const [predecessor, successor] = this.getNeighbor(node, siblings, i);

        // Insert into balanced tree.
        if (predecessor !== null) {
          // Insert immediately after predecessor: as its right child,
          // or as the leftmost descendant of its existing right child.
          if (predecessor.bRightChild === null) {
            predecessor.bRightChild = node;
            node.bParent = predecessor;
          } else {
            let current = predecessor.bRightChild;
            while (current.bLeftChild !== null) current = current.bLeftChild;
            current.bLeftChild = node;
            node.bParent = current;
          }
        } else if (successor !== null) {
          // Insert immediately before successor: as its left child,
          // or as the rightmost descendant of its existing left child.
          if (successor.bLeftChild === null) {
            successor.bLeftChild = node;
            node.bParent = successor;
          } else {
            let current = successor.bLeftChild;
            while (current.bRightChild !== null) current = current.bRightChild;
            current.bRightChild = node;
            node.bParent = current;
          }
        }

        // Update index metadata.
        for (
          let ancestor: Node | null = node;
          ancestor !== null;
          ancestor = ancestor.bParent
        ) {
          ancestor.bCount++;
        }

        // Rebalance AVL tree.
        this.rebalance(node);

        // Update SALMS.
        if (node.isLeftChild) {
          if (i === 0) {
            // node captures the parent's leftmost descendant.
            if (siblings.length >= 2) this.leftSALM.split(parent);
            this.leftSALM.append(parent, node);
          } else this.leftSALM.create(node); // No one's leftmost descendant.
          this.rightSALM.create(node); // No one's rightmost descendant.
        } else {
          if (i === siblings.length - 1) {
            // node captures the parent's rightmost descendant.
            if (siblings.length >= 2) this.rightSALM.split(parent);
            this.rightSALM.append(parent, node);
          } else this.rightSALM.create(node); // No one's rightmost descendant.
          this.leftSALM.create(node); // No one's leftmost descendant.
        }

        // Event.
        this.emit("Insert", {
          startIndex: this.nodeToIndex(node)[0],
          count: 1,
          meta,
        });
        break;
      }
      case "delete": {
        const node = this.nodesByID.get(decoded.id)!;
        if (node.isPresent) {
          const index = this.nodeToIndex(node)[0];
          node.isPresent = false;

          // Update index metadata.
          for (
            let bAncestor: Node | null = node;
            bAncestor !== null;
            bAncestor = bAncestor.bParent
          ) {
            bAncestor.bCount--;
          }

          // Event.
          this.emit("Delete", {
            startIndex: index,
            count: 1,
            deletedValues: node.value,
            meta,
          });
        }
        break;
      }
    }
  }

  /**
   * Find a neighbor (predecessor or successor) of the newly inserted node
   * in the ground-truth tree, counting deleted nodes.
   * @param  node
   * @param  siblings node's siblings.
   * @param  i        node's index within siblings.
   * @return          either predecessor or successor (other is null).
   */
  private getNeighbor(
    node: Node,
    siblings: Node[],
    i: number
  ): [predecessor: Node | null, successor: Node | null] {
    let predecessor: Node | null = null;
    let successor: Node | null = null;
    if (node.isLeftChild) {
      if (i === siblings.length - 1) {
        successor = node.parent!;
      } else {
        // Next sibling's leftmost descendant is our successor.
        successor = this.leftSALM.getEnd(siblings[i + 1]);
      }
    } else {
      if (i === 0) predecessor = node.parent!;
      else {
        // Previous sibling's rightmost descendant is our predecessor.
        predecessor = this.rightSALM.getEnd(siblings[i - 1]);
      }
    }

    return [predecessor, successor];
  }

  /**
   * AVL tree rebalance starting at the given newly inserted node.
   * This also updates balanced factors to account for the new node.
   */
  private rebalance(node: Node): void {
    // Using wikipedia alg: https://en.wikipedia.org/wiki/AVL_tree#Insert
    let Z = node;
    let G: Node | null = null;
    for (let X = Z.bParent; X !== null; X = Z.bParent) {
      let N: Node;
      if (Z === X.bRightChild) {
        if (X.bF > 0) {
          G = X.bParent;
          if (Z.bF < 0) N = this.rotate_RightLeft(X, Z);
          else N = this.rotate_Left(X, Z);
        } else {
          if (X.bF < 0) {
            X.bF = 0;
            break;
          }
          X.bF = 1;
          Z = X;
          continue;
        }
      } else {
        if (X.bF < 0) {
          G = X.bParent;
          if (Z.bF > 0) N = this.rotate_LeftRight(X, Z);
          else N = this.rotate_Right(X, Z);
        } else {
          if (X.bF > 0) {
            X.bF = 0;
            break;
          }
          X.bF = -1;
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
      } else this.bRootNode = N;
      break;
    }
  }

  private rotate_Left(X: Node, Z: Node): Node {
    const t23 = Z.bLeftChild;
    X.bRightChild = t23;
    if (t23 !== null) t23.bParent = X;
    Z.bLeftChild = X;
    X.bParent = Z;
    if (Z.bF === 0) {
      X.bF = 1;
      Z.bF = -1;
    } else {
      X.bF = 0;
      Z.bF = 0;
    }

    // Update bCount's of all nodes whose children changed, in bottom-up
    // order so that they are accurate.
    this.updateBCount(X);
    this.updateBCount(Z);

    return Z;
  }

  private rotate_Right(X: Node, Z: Node): Node {
    const t23 = Z.bRightChild;
    X.bLeftChild = t23;
    if (t23 !== null) t23.bParent = X;
    Z.bRightChild = X;
    X.bParent = Z;
    if (Z.bF === 0) {
      X.bF = 1;
      Z.bF = -1;
    } else {
      X.bF = 0;
      Z.bF = 0;
    }

    this.updateBCount(X);
    this.updateBCount(Z);

    return Z;
  }

  private rotate_RightLeft(X: Node, Z: Node): Node {
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
    if (Y.bF === 0) {
      X.bF = 0;
      Z.bF = 0;
    } else {
      if (Y.bF > 0) {
        X.bF = -1;
        Z.bF = 0;
      } else {
        X.bF = 0;
        Z.bF = 1;
      }
    }
    Y.bF = 0;

    this.updateBCount(X);
    this.updateBCount(Z);
    this.updateBCount(Y);

    return Y;
  }

  private rotate_LeftRight(X: Node, Z: Node): Node {
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
    if (Y.bF === 0) {
      X.bF = 0;
      Z.bF = 0;
    } else {
      if (Y.bF > 0) {
        X.bF = -1;
        Z.bF = 0;
      } else {
        X.bF = 0;
        Z.bF = 1;
      }
    }
    Y.bF = 0;

    this.updateBCount(X);
    this.updateBCount(Z);
    this.updateBCount(Y);

    return Y;
  }

  /**
   * Set node.bCount assuming its bChildren's bCounts are accurate.
   */
  private updateBCount(node: Node): void {
    node.bCount =
      (node.bLeftChild?.bCount ?? 0) +
      (node.isPresent ? 1 : 0) +
      (node.bRightChild?.bCount ?? 0);
  }

  /**
   * Time O(log(n)).
   * @param  index [description]
   * @return       [description]
   */
  private indexToNode(index: number): Node {
    if (index < 0 || index >= this.length) {
      throw new Error(`index out of bounds: ${index}, ${this.length}`);
    }

    let remaining = index;
    let current = this.bRootNode;
    for (;;) {
      if (current.bLeftChild !== null) {
        const child = current.bLeftChild;
        if (remaining < child.bCount) {
          // "Recurse".
          current = child;
          continue;
        } else remaining -= child.bCount;
      }
      if (current.isPresent) {
        if (remaining === 0) return current;
        else remaining--;
      }
      if (
        current.bRightChild === null ||
        current.bRightChild.bCount < remaining
      ) {
        // Done walking current, but didn't find index.
        throw new Error(
          `Internal error: failed to find valid index: ${index}, ${this.length}`
        );
      }
      // "Recurse".
      current = current.bRightChild;
    }
  }

  /**
   * Time O(log(n)).
   * @param  node [description]
   * @return      [description]
   */
  private nodeToIndex(node: Node): [geIndex: number, isPresent: boolean] {
    // Count the number of present nodes prior to node.
    let geIndex = 0;

    // First, count the contribution of node's left descendants.
    if (node.bLeftChild !== null) geIndex += node.bLeftChild.bCount;

    // Next, count the contribution of nodes outside node's subtree.
    let curNode = node;
    let curParent = node.bParent;
    while (curParent !== null) {
      // If curNode is a right child, count its left sibling and parent.
      if (!curNode.bIsLeftChild) {
        geIndex += curParent.bLeftChild?.bCount ?? 0;
        // Count parent if present.
        if (curParent.isPresent) geIndex++;
      }
      // Go up a layer.
      curNode = curParent;
      curParent = curNode.bParent;
    }

    return [geIndex, node.isPresent];
  }

  /**
   * Returns the next node after node in the balanced tree (possibly deleted).
   * It is assumed that node is not last.
   *
   * Time: O(log(n)).
   */
  private nextNode(node: Node): Node {
    if (node.bRightChild !== null) {
      // Return the leftmost descendent of bRightChild.
      let current = node.bRightChild;
      while (current.bLeftChild !== null) current = current.bLeftChild;
      return current;
    } else {
      // Go upwards until we turn right; that rightwards ancestor is next.
      let current = node;
      for (;;) {
        if (current.bIsLeftChild) return current.bParent!;
        if (current.bParent === null) {
          throw new Error("node is last");
        }
        current = current.bParent;
      }
    }
  }

  get length(): number {
    return this.bRootNode.bCount;
  }

  toString(): string {
    const values = new Array<string>(this.length);

    // Walk the balanced tree.
    let node: Node | null = this.bRootNode;
    let lastWalked: LastWalked = LastWalked.PARENT;
    while (node !== null) {
      switch (lastWalked) {
        case LastWalked.PARENT:
          // We are just starting to walk the subtree at node.
          if (node.bLeftChild !== null && node.bLeftChild.bCount !== 0) {
            // Walk it next.
            node = node.bLeftChild;
            // lastWalked = LastWalked.PARENT;
          } else {
            // Skip over the left subtree.
            // node = node;
            lastWalked = LastWalked.LEFT_CHILD;
          }
          break;
        case LastWalked.LEFT_CHILD:
          // We just finished walking the left child. Now visit this node
          // followed by its right subtree.
          if (node.isPresent) values.push(node.value);
          if (node.bRightChild !== null && node.bRightChild.bCount !== 0) {
            // Walk it next.
            node = node.bRightChild;
            lastWalked = LastWalked.PARENT;
          } else {
            // Skip over the right subtree.
            // node = node;
            lastWalked = LastWalked.RIGHT_CHILD;
          }
          break;
        case LastWalked.RIGHT_CHILD:
          // We just finished walking the right child, hence node's whole sbutree.
          // Go back up.
          lastWalked = node.bIsLeftChild
            ? LastWalked.LEFT_CHILD
            : LastWalked.RIGHT_CHILD;
          node = node.bParent;
          break;
      }
    }

    const ans = values.join("");
    if (ans.length !== this.length) {
      throw new Error("Internal error: toString() has wrong length");
    }
    return ans;
  }

  getPosition(index: number): string {
    return this.indexToNode(index).id;
  }

  findPosition(position: string): [geIndex: number, isPresent: boolean] {
    return this.nodeToIndex(this.nodesByID.get(position)!);
  }

  save(): Uint8Array {
    throw new Error("Method not implemented.");
  }

  load(saveData: collabs.Optional<Uint8Array>): void {
    if (!saveData.isPresent) return;
    throw new Error("Method not implemented.");
  }

  canGC(): boolean {
    return false;
  }

  // Debugging

  printTrueTreeWalk(): void {
    console.log("printTrueTreeWalk:");
    // Walk the ground truth tree.
    const stack: [node: Node, left: boolean, childIndex: number][] = [];
    let node = this.rootNode;
    let left = true;
    let childIndex = 0;
    for (;;) {
      if (childIndex === node.children(left).length) {
        if (left) {
          // Visit node.
          const tabs = new Array<string>(stack.length).fill("  ").join("");
          console.log(
            tabs +
              JSON.stringify({
                id: node.id,
                value: node.value,
                isPresent: node.isPresent,
                leftSAL: this.leftSALM.getTreeID(node),
                rightSAL: this.rightSALM.getTreeID(node),
              })
          );
          // Move to right children.
          left = false;
          childIndex = 0;
          continue;
        } else {
          // Done with node; pop the stack.
          if (stack.length === 0) {
            // Completely done.
            return;
          }
          [node, left, childIndex] = stack.pop()!;
          childIndex++;
          continue;
        }
      }

      const child = node.children(left)[childIndex];
      // Recurse.
      stack.push([node, left, childIndex]);
      node = child;
      left = true;
      childIndex = 0;
    }
  }

  printBalancedTreeWalk(): void {
    console.log("printBalancedTreeWalk:");
    // Walk the balanced tree.
    let node: Node | null = this.bRootNode;
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
          console.log(
            tabs +
              JSON.stringify({
                id: node.id,
                value: node.value,
                isPresent: node.isPresent,
                count: node.bCount,
                bF: node.bF,
              })
          );
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

  /**
   * Check that all SALM getEnd calls give the right answer, otherwise
   * throwing an error.
   *
   * Note: expensive operation.
   */
  checkSALMs(): void {
    console.log("checkSALMs");
    // Walk the ground truth tree.
    const stack: [node: Node, left: boolean, childIndex: number][] = [];
    let node = this.rootNode;
    let left = true;
    let childIndex = 0;
    for (;;) {
      if (childIndex === node.children(left).length) {
        if (left) {
          // Visit node.
          {
            const salmLeftDescendant = this.leftSALM.getEnd(node);
            const trueLeftDescendent = this.getLeftmostDescendant(node);
            if (salmLeftDescendant !== trueLeftDescendent) {
              throw new Error(
                "Wrong SALM leftmost descendant for " +
                  node.id +
                  ": " +
                  salmLeftDescendant.id +
                  ", " +
                  trueLeftDescendent.id
              );
            }
          }
          {
            const salmRightDescendant = this.rightSALM.getEnd(node);
            const trueRightDescendent = this.getRightmostDescendant(node);
            if (salmRightDescendant !== trueRightDescendent) {
              throw new Error(
                "Wrong SALM rightmost descendant for " +
                  node.id +
                  ": " +
                  salmRightDescendant.id +
                  ", " +
                  trueRightDescendent.id
              );
            }
          }
          // Move to right children.
          left = false;
          childIndex = 0;
          continue;
        } else {
          // Done with node; pop the stack.
          if (stack.length === 0) {
            // Completely done.
            return;
          }
          [node, left, childIndex] = stack.pop()!;
          childIndex++;
          continue;
        }
      }

      const child = node.children(left)[childIndex];
      // Recurse.
      stack.push([node, left, childIndex]);
      node = child;
      left = true;
      childIndex = 0;
    }
  }

  private getLeftmostDescendant(node: Node): Node {
    let current = node;
    while (current.leftChildren.length !== 0) current = current.leftChildren[0];
    return current;
  }

  private getRightmostDescendant(node: Node): Node {
    let current = node;
    while (current.rightChildren.length !== 0)
      current = current.rightChildren[current.rightChildren.length - 1];
    return current;
  }
}
