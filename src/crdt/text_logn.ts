import * as collabs from "@collabs/collabs";

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
}

export class CTextLogn
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
        let i = 0;
        for (; i < siblings.length; i++) {
          if (node.id < siblings[i].id) break;
        }
        siblings.splice(i, 0, node);

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

  private indexToNode(index: number): Node {}

  private nodeToIndex(node: Node): [geIndex: number, isPresent: boolean] {}

  /**
   * Returns the next node to the right, include deleted nodes.
   * It is assumed that node is not the last node.
   */
  private nextNode(node: Node): Node {}

  get length(): number {}

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
    throw new Error("Method not implemented.");
  }

  canGC(): boolean {
    return false;
  }
}
