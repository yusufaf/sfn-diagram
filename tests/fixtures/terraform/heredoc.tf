# Order processing state machine
provider "aws" {
  region = "us-east-1"
}

variable "wait" {
  type    = number
  default = 5
}

// Unrelated resources must not break extraction.
resource "aws_iam_role_policy" "invoke" {
  name = "invoke"
  role = aws_iam_role.sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [for arn in var.lambda_arns : {
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "notes" {
  /* a block comment
     over two lines */
  name = <<NOTE
%{ if true }enabled%{ endif }
NOTE
}

resource "aws_sfn_state_machine" "orders" {
  name     = "orders"
  role_arn = aws_iam_role.sfn.arn

  logging_configuration {
    level                  = "ALL"
    include_execution_data = true
    log_destination        = "${aws_cloudwatch_log_group.notes.arn}:*"
  }

  definition = <<EOF
{
  "Comment": "Charge then wait",
  "StartAt": "Charge",
  "States": {
    "Charge": {
      "Type": "Task",
      "Resource": "${aws_lambda_function.charge.arn}",
      "Next": "Pause"
    },
    "Pause": {
      "Type": "Wait",
      "Seconds": ${var.wait},
      "Next": "Done"
    },
    "Done": { "Type": "Succeed" }
  }
}
EOF
}
