resource "aws_sfn_state_machine" "encoded" {
  name     = "encoded"
  role_arn = "arn:aws:iam::123456789012:role/sfn"

  definition = jsonencode({
    Comment = "Charge with a retry"
    StartAt = "Charge"
    States = {
      Charge = {
        Type     = "Task"
        Resource = aws_lambda_function.charge.arn
        Parameters = {
          FunctionName = format("%s-fn", var.env)
        }
        Retry = [{
          ErrorEquals     = ["States.ALL"]
          IntervalSeconds = 2
          BackoffRate     = 1.5
          MaxAttempts     = 3
        }]
        Next = "Wait 5"
      }
      "Wait 5" : {
        Type    = "Wait"
        Seconds = 5
        Next    = "Done"
      }
      Done = {
        Type = "Succeed"
      }
    }
    TimeoutSeconds = 3e2
    Extras         = [-1, true, false, null]
  })
}
