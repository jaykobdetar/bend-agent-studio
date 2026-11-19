import Base
import ../core/engine.bend as E
import ../core/doors.bend as Doors
import ./bandit.bend as Bandit

def hooks() -> E.Hooks<Doors.Hall, U32, Bandit.Model>:
  E.Hooks{Doors.world(), Bandit.act, Bandit.learn}

def evaluate(model: Bandit.Model) -> Pair(Bandit.Model, E.Totals):
  E.run(~Doors.Hall, ~U32, ~Bandit.Model, ~hooks(), E.Evaluate{}, model, 1000, 8n, 4n)

def train(model: Bandit.Model) -> Pair(Bandit.Model, E.Totals):
  E.run(~Doors.Hall, ~U32, ~Bandit.Model, ~hooks(), E.Train{}, model, 42, 16n, 4n)

def score(result: Pair(Bandit.Model, E.Totals)) -> F32:
  (model, E.Totals{points, steps, terminal, limited, illegal}) = result
  points

def after_training(result: Pair(Bandit.Model, E.Totals)) -> F32:
  (model, totals) = result
  score(evaluate(model))

def main() -> IO(Unit):
  before = score(evaluate(Bandit.initial()))
  after = after_training(train(Bandit.initial()))
  IO.print("Correct doors on 16 evaluation turns: " ++ F32.show(before) ++ " before training, " ++ F32.show(after) ++ " after training.")
