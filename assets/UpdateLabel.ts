import { Component, Label, _decorator } from "cc";
import mobx from "mobx";
import { observer, render } from "./mobx/observer";

const { observable, runInAction } = mobx;
const { ccclass, property } = _decorator;

@ccclass("UpdateLabel")
@observer
export class UpdateLabel extends Component {
  @observable count = 0;
  onLoad() {
    this.schedule(
      () => {
        runInAction(() => this.count++);
      },
      1,
      9999999,
      0
    );
    // [3]
  }

  @render renderLabel() {
    this.getComponent(Label).string = `${this.count}`;
  }
}
