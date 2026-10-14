resource "aws_sfn_state_machine" "templated" {
  name     = "templated"
  role_arn = "arn:aws:iam::123456789012:role/sfn"

  definition = templatefile("${path.module}/sfn.asl.json", {
    lambda_arn = aws_lambda_function.x.arn
  })
}
