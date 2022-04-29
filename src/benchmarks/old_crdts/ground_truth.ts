import * as collabs from "@collabs/collabs";

// Ground truth: CRDT tree only, no other layers.
// So operation times are O(n) in the worst case (may need to walk a long
// path in the tree).

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
  /**
   * Number of present nodes in this node's subtree, including itself.
   */
  count = 0;

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
}

export class CTextLognGroundTruth
  extends collabs.CPrimitive<collabs.CTextEventsRecord>
  implements collabs.PositionedList
{
  private readonly rootNode: Node;
  private readonly nodesByID = new Map<string, Node>();

  constructor(initToken: collabs.InitToken) {
    super(initToken);

    // Create root node.
    this.rootNode = new Node("", null, false, "", false);
    this.nodesByID.set(this.rootNode.id, this.rootNode);
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
      const firstRightChild = leftOrigin.rightChildren[0];
      parent = this.leftmostDescendant(firstRightChild);
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
        let i = 0;
        for (; i < siblings.length; i++) {
          if (node.id < siblings[i].id) break;
        }
        siblings.splice(i, 0, node);

        // Update index metadata.
        for (
          let ancestor: Node | null = node;
          ancestor !== null;
          ancestor = ancestor.parent
        ) {
          ancestor.count++;
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
            let ancestor: Node | null = node;
            ancestor !== null;
            ancestor = ancestor.parent
          ) {
            ancestor.count--;
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

  private indexToNode(index: number): Node {
    if (index < 0 || index >= this.length) {
      throw new Error(`index out of bounds: ${index}, ${this.length}`);
    }

    let remaining = index;
    let current = this.rootNode;
    for (;;) {
      child_loop: {
        for (const child of current.leftChildren) {
          if (remaining < child.count) {
            // "Recurse".
            current = child;
            break child_loop;
          } else remaining -= child.count;
        }
        if (current.isPresent) {
          if (remaining === 0) return current;
          else remaining--;
        }
        for (const child of current.rightChildren) {
          if (remaining < child.count) {
            // "Recurse".
            current = child;
            break child_loop;
          } else remaining -= child.count;
        }
        // Done walking current, but didn't find index.
        throw new Error(
          `Internal error: failed to find valid index: ${index}, ${this.length}`
        );
      }
    }
  }

  private nodeToIndex(node: Node): [geIndex: number, isPresent: boolean] {
    // Count the number of present nodes prior to node.
    let geIndex = 0;

    // First, count the contribution of node's left descendants.
    for (const leftChild of node.leftChildren) geIndex += leftChild.count;

    // Next, count the contribution of nodes outside node's subtree.
    let curNode = node;
    let curParent = node.parent;
    while (curParent !== null) {
      // Count further-left siblings of curNode.
      for (const child of curParent.leftChildren) {
        if (child === curNode) break;
        geIndex += child.count;
      }
      if (!curNode.isLeftChild) {
        for (const child of curParent.rightChildren) {
          if (child === curNode) break;
          geIndex += child.count;
        }
        // Count parent if present.
        if (curParent.isPresent) geIndex++;
      }
      // Go up a layer.
      curNode = curParent;
      curParent = curNode.parent;
    }

    return [geIndex, node.isPresent];
  }

  /**
   * Returns the leftmost descendant of node.
   */
  private leftmostDescendant(node: Node): Node {
    let current = node;
    while (current.leftChildren.length > 0) {
      current = current.leftChildren[0];
    }
    return current;
  }

  get length(): number {
    return this.rootNode.count;
  }

  toString(): string {
    const values = new Array<string>(this.length);

    // Walk the tree.
    const stack: [node: Node, left: boolean, childIndex: number][] = [];
    let node = this.rootNode;
    let left = true;
    let childIndex = 0;
    for (;;) {
      if (childIndex === node.children(left).length) {
        if (left) {
          // Visit node.
          if (node.isPresent) values.push(node.value);
          // Move to right children.
          left = false;
          childIndex = 0;
          continue;
        } else {
          // Done with node; pop the stack.
          if (stack.length === 0) {
            // Completely done.
            const ans = values.join("");
            if (ans.length !== this.length) {
              throw new Error("Internal error: toString() has wrong length");
            }
            return ans;
          }
          [node, left, childIndex] = stack.pop()!;
          childIndex++;
          continue;
        }
      }

      const child = node.children(left)[childIndex];
      // Recurse if nonempty, else move to the next child.
      if (child.count > 0) {
        stack.push([node, left, childIndex]);
        node = child;
        left = true;
        childIndex = 0;
        continue;
      } else {
        childIndex++;
      }
    }
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

  printTreeWalk(): void {
    // Walk the tree.
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
                count: node.count,
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
}
