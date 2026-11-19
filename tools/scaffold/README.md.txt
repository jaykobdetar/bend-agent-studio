# @NAME@

## What it learns

Nothing yet. The model is a constant over unsigned discrete observations.
The placeholder chooses the first legal action and leaves its model unchanged.

## Parameters

The placeholder does not use any parameters.

## Episode ends

No state is buffered between decisions. The ordinary Hooks adapter is enough.

## Laws

The placeholder update leaves every model unchanged for every transition.

## Checks

Run `bend checks.bend` and `bend proof.bend --verdict` from this directory.
Replace the placeholder law and its numerical check when changing the update.

## Example plan

Run `node ../../experiment.mjs validate example.json` from this directory in
the project checkout. The example is finite, one step long and has disjoint
seed blocks.
